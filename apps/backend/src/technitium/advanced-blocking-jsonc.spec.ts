import {
  AdvancedBlockingCommentPreservationError,
  applyAdvancedBlockingJsoncChanges,
  calculateAdvancedBlockingConfigRevision,
  listAdvancedBlockingDomainComments,
  mutateAdvancedBlockingDomainComment,
  parseAdvancedBlockingJsonc,
  patchAdvancedBlockingJsonc,
} from "./advanced-blocking-jsonc";
import type {
  AdvancedBlockingConfig,
  AdvancedBlockingGroup,
} from "./advanced-blocking.types";

const createGroup = (
  overrides: Partial<AdvancedBlockingGroup> = {},
): AdvancedBlockingGroup => ({
  name: "default",
  blockingAddresses: [],
  allowed: [],
  blocked: [],
  allowListUrls: [],
  blockListUrls: [],
  allowedRegex: [],
  blockedRegex: [],
  regexAllowListUrls: [],
  regexBlockListUrls: [],
  adblockListUrls: [],
  ...overrides,
});

const createConfig = (
  overrides: Partial<AdvancedBlockingConfig> = {},
): AdvancedBlockingConfig => ({
  localEndPointGroupMap: {},
  networkGroupMap: {},
  groups: [],
  ...overrides,
});

describe("Advanced Blocking JSONC", () => {
  it("parses line comments, block comments, and trailing commas", () => {
    expect(
      parseAdvancedBlockingJsonc(`{
        // root setting
        "enableBlocking": true,
        /* group mappings */
        "networkGroupMap": {
          "192.0.2.0/24": "default",
        },
      }`),
    ).toEqual({
      enableBlocking: true,
      networkGroupMap: { "192.0.2.0/24": "default" },
    });
  });

  it("reports a useful location for malformed JSONC", () => {
    expect(() =>
      parseAdvancedBlockingJsonc(`{
  "enableBlocking":,
}`),
    ).toThrow(/ValueExpected.*line 2 column 20/);
  });

  it("calculates revisions from the exact raw document", () => {
    const compact = `{"enableBlocking":true}`;
    const commented = `{
  // canonical
  "enableBlocking": true
}`;

    expect(calculateAdvancedBlockingConfigRevision(compact)).not.toBe(
      calculateAdvancedBlockingConfigRevision(commented),
    );
    expect(calculateAdvancedBlockingConfigRevision(commented)).toBe(
      calculateAdvancedBlockingConfigRevision(commented),
    );
  });

  it("updates scalar values without changing comments or unknown fields", () => {
    const raw = `{
  // this rationale is canonical
  "enableBlocking": true,
  "futureSetting": {
    /* retained verbatim */
    "mode": "future"
  },
  "localEndPointGroupMap": {},
  "networkGroupMap": {},
  "groups": []
}
`;

    const patched = patchAdvancedBlockingJsonc(
      raw,
      createConfig({ enableBlocking: false }),
    );

    expect(patched).toContain("// this rationale is canonical");
    expect(patched).toContain("/* retained verbatim */");
    expect(patched).toContain('"futureSetting": {');
    expect(patched).toContain('"enableBlocking": false');
    expect(parseAdvancedBlockingJsonc(patched)).toMatchObject({
      enableBlocking: false,
      futureSetting: { mode: "future" },
    });
  });

  it("retains existing array order when the desired config is reordered", () => {
    const raw = `{
  "localEndPointGroupMap": {},
  "networkGroupMap": {},
  "groups": [{
    "name": "default",
    "blockingAddresses": [],
    "allowed": [
      // first stays attached to alpha
      "alpha.example",
      // second stays attached to beta
      "beta.example"
    ],
    "blocked": [],
    "allowListUrls": [],
    "blockListUrls": [],
    "allowedRegex": [],
    "blockedRegex": [],
    "regexAllowListUrls": [],
    "regexBlockListUrls": [],
    "adblockListUrls": []
  }]
}`;

    const patched = patchAdvancedBlockingJsonc(
      raw,
      createConfig({
        groups: [
          createGroup({
            allowed: ["beta.example", "alpha.example", "gamma.example"],
          }),
        ],
      }),
    );

    expect(patched.indexOf('"alpha.example"')).toBeLessThan(
      patched.indexOf('"beta.example"'),
    );
    expect(patched.indexOf('"beta.example"')).toBeLessThan(
      patched.indexOf('"gamma.example"'),
    );
    expect(patched).toContain("// first stays attached to alpha");
    expect(patched).toContain("// second stays attached to beta");
  });

  it("patches nested URL overrides without replacing their comments", () => {
    const raw = `{
  "localEndPointGroupMap": {},
  "networkGroupMap": {},
  "groups": [{
    "name": "default",
    "blockingAddresses": [],
    "allowed": [],
    "blocked": [],
    "allowListUrls": [],
    "blockListUrls": [{
      "url": "https://lists.example/block.txt",
      // explains why this list needs NXDOMAIN
      "blockAsNxDomain": false,
      "futureOverride": "keep"
    }],
    "allowedRegex": [],
    "blockedRegex": [],
    "regexAllowListUrls": [],
    "regexBlockListUrls": [],
    "adblockListUrls": []
  }]
}`;

    const patched = patchAdvancedBlockingJsonc(
      raw,
      createConfig({
        groups: [
          createGroup({
            blockListUrls: [
              {
                url: "https://lists.example/block.txt",
                blockAsNxDomain: true,
              },
            ],
          }),
        ],
      }),
    );

    expect(patched).toContain("// explains why this list needs NXDOMAIN");
    expect(patched).toContain('"blockAsNxDomain": true');
    expect(patched).toContain('"futureOverride": "keep"');
  });

  it("deletes an entry without consuming the next entry's leading comment", () => {
    const raw = `{
  "localEndPointGroupMap": {},
  "networkGroupMap": {},
  "groups": [{
    "name": "default",
    "blockingAddresses": [],
    "allowed": [
      "alpha.example",
      // must remain attached to beta
      "beta.example"
    ],
    "blocked": [],
    "allowListUrls": [],
    "blockListUrls": [],
    "allowedRegex": [],
    "blockedRegex": [],
    "regexAllowListUrls": [],
    "regexBlockListUrls": [],
    "adblockListUrls": []
  }]
}`;

    const patched = patchAdvancedBlockingJsonc(
      raw,
      createConfig({
        groups: [createGroup({ allowed: ["beta.example"] })],
      }),
    );

    expect(patched).not.toContain('"alpha.example"');
    expect(patched).toContain("// must remain attached to beta");
    expect(listAdvancedBlockingDomainComments(patched)).toEqual([
      expect.objectContaining({
        value: "beta.example",
        text: "must remain attached to beta",
      }),
    ]);
  });

  it("rejects a deletion that would retarget a surviving comment", () => {
    const raw = `{
  "localEndPointGroupMap": {},
  "networkGroupMap": {},
  "groups": [{
    "name": "default",
    "blockingAddresses": [],
    "allowed": [
      // rationale belongs to alpha
      "alpha.example",
      "beta.example"
    ],
    "blocked": [],
    "allowListUrls": [],
    "blockListUrls": [],
    "allowedRegex": [],
    "blockedRegex": [],
    "regexAllowListUrls": [],
    "regexBlockListUrls": [],
    "adblockListUrls": []
  }]
}`;

    expect(() =>
      patchAdvancedBlockingJsonc(
        raw,
        createConfig({
          groups: [createGroup({ allowed: ["beta.example"] })],
        }),
      ),
    ).toThrow(AdvancedBlockingCommentPreservationError);
  });

  it("allows deletion when no comments are endangered", () => {
    const raw = JSON.stringify(
      createConfig({
        groups: [
          createGroup({
            allowed: ["alpha.example", "beta.example"],
          }),
        ],
      }),
      null,
      2,
    );

    const patched = patchAdvancedBlockingJsonc(
      raw,
      createConfig({
        groups: [createGroup({ allowed: ["beta.example"] })],
      }),
    );

    const parsed = parseAdvancedBlockingJsonc(patched) as {
      groups: Array<{ allowed: string[] }>;
    };
    expect(parsed.groups[0].allowed).toEqual(["beta.example"]);
  });

  it("does not mistake comment-like text inside strings for comments", () => {
    const raw = `{
  "localEndPointGroupMap": {},
  "networkGroupMap": {},
  "groups": [{
    "name": "default",
    "blockingAddresses": [],
    "allowed": [],
    "blocked": [],
    "allowListUrls": [],
    "blockListUrls": ["https://lists.example/path//segment"],
    "allowedRegex": [],
    "blockedRegex": [],
    "regexAllowListUrls": [],
    "regexBlockListUrls": [],
    "adblockListUrls": []
  }]
}`;

    expect(() =>
      patchAdvancedBlockingJsonc(
        raw,
        createConfig({
          groups: [
            createGroup({
              blockListUrls: ["https://lists.example/path//segment"],
              enableBlocking: true,
            }),
          ],
        }),
      ),
    ).not.toThrow();
  });

  it("associates leading and trailing comments with domain entries", () => {
    const raw = `{
  // root comment is not a domain comment
  "groups": [{
    "name": "default",
    "blocked": [
      // leading alpha
      "alpha.example",
      "beta.example", // trailing beta
      /* leading gamma */
      "gamma.example"
    ]
  }]
}`;

    expect(listAdvancedBlockingDomainComments(raw)).toEqual([
      expect.objectContaining({
        groupName: "default",
        field: "blocked",
        value: "alpha.example",
        occurrence: 0,
        placement: "leading",
        style: "line",
        text: "leading alpha",
      }),
      expect.objectContaining({
        groupName: "default",
        field: "blocked",
        value: "beta.example",
        occurrence: 0,
        placement: "trailing",
        style: "line",
        text: "trailing beta",
      }),
      expect.objectContaining({
        groupName: "default",
        field: "blocked",
        value: "gamma.example",
        occurrence: 0,
        placement: "leading",
        style: "block",
        text: "leading gamma",
      }),
    ]);
  });

  it("adds, edits, and removes a domain comment without touching peers", () => {
    const raw = `{
  "groups": [{
    "name": "default",
    "blocked": [
      // alpha rationale
      "alpha.example",
      "beta.example"
    ]
  }]
}`;

    const added = mutateAdvancedBlockingDomainComment(raw, {
      action: "add",
      configRevision: "unused-by-pure-helper",
      groupName: "default",
      field: "blocked",
      value: "beta.example",
      occurrence: 0,
      text: "beta rationale",
    });
    expect(added).toContain("// alpha rationale");
    expect(added).toContain("// beta rationale");

    const betaComment = listAdvancedBlockingDomainComments(added).find(
      (comment) => comment.value === "beta.example",
    );
    expect(betaComment).toBeDefined();

    const edited = mutateAdvancedBlockingDomainComment(added, {
      action: "edit",
      configRevision: "unused-by-pure-helper",
      commentId: betaComment!.id,
      text: "updated beta rationale",
    });
    expect(edited).toContain("// alpha rationale");
    expect(edited).toContain("// updated beta rationale");

    const editedBetaComment = listAdvancedBlockingDomainComments(edited).find(
      (comment) => comment.value === "beta.example",
    );
    const removed = mutateAdvancedBlockingDomainComment(edited, {
      action: "remove",
      configRevision: "unused-by-pure-helper",
      commentId: editedBetaComment!.id,
    });
    expect(removed).toContain("// alpha rationale");
    expect(removed).not.toContain("beta rationale");
    expect(parseAdvancedBlockingJsonc(removed)).toBeDefined();
  });

  it("addresses duplicate domain entries by occurrence", () => {
    const raw = `{
  "groups": [{
    "name": "default",
    "allowed": [
      "duplicate.example",
      "duplicate.example"
    ]
  }]
}`;

    const updated = mutateAdvancedBlockingDomainComment(raw, {
      action: "add",
      configRevision: "unused-by-pure-helper",
      groupName: "default",
      field: "allowed",
      value: "duplicate.example",
      occurrence: 1,
      text: "second occurrence only",
      style: "block",
    });

    expect(listAdvancedBlockingDomainComments(updated)).toEqual([
      expect.objectContaining({
        value: "duplicate.example",
        occurrence: 1,
        style: "block",
        text: "second occurrence only",
      }),
    ]);
  });

  it("promotes multiline line-comment edits to one block comment", () => {
    const raw = `{
  "groups": [{
    "name": "default",
    "blocked": [
      // original rationale
      "alpha.example"
    ]
  }]
}`;
    const [comment] = listAdvancedBlockingDomainComments(raw);
    const updated = mutateAdvancedBlockingDomainComment(raw, {
      action: "edit",
      commentId: comment.id,
      text: "first line\nsecond line",
    });

    expect(updated).toContain("/* first line\nsecond line */");
    expect(listAdvancedBlockingDomainComments(updated)).toEqual([
      expect.objectContaining({
        value: "alpha.example",
        style: "block",
        text: "first line\nsecond line",
      }),
    ]);
  });

  it("rejects block delimiters without modifying the source JSONC", () => {
    const raw = `{
  "groups": [{
    "name": "default",
    "blocked": ["alpha.example"]
  }]
}`;

    expect(() =>
      mutateAdvancedBlockingDomainComment(raw, {
        action: "add",
        groupName: "default",
        field: "blocked",
        value: "alpha.example",
        occurrence: 0,
        text: "unsafe */ delimiter",
        style: "block",
      }),
    ).toThrow('cannot contain "*/"');
    expect(parseAdvancedBlockingJsonc(raw)).toBeDefined();
  });

  it("allows unicode and block-like text in a single-line comment", () => {
    const raw = `{
  "groups": [{
    "name": "default",
    "blocked": ["alpha.example"]
  }]
}`;
    const updated = mutateAdvancedBlockingDomainComment(raw, {
      action: "add",
      groupName: "default",
      field: "blocked",
      value: "alpha.example",
      occurrence: 0,
      text: "理由 */ remains line-safe",
      style: "line",
    });

    expect(updated).toContain("// 理由 */ remains line-safe");
    expect(parseAdvancedBlockingJsonc(updated)).toBeDefined();
  });

  it("preserves CRLF line endings when adding comments", () => {
    const raw = [
      "{",
      '  "groups": [{',
      '    "name": "default",',
      '    "blocked": ["alpha.example"]',
      "  }]",
      "}",
    ].join("\r\n");
    const updated = mutateAdvancedBlockingDomainComment(raw, {
      action: "add",
      groupName: "default",
      field: "blocked",
      value: "alpha.example",
      occurrence: 0,
      text: "CRLF rationale",
      style: "line",
    });

    expect(updated).toContain("// CRLF rationale\r\n");
    expect(updated.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("edits and removes trailing comments without touching the domain", () => {
    const raw = `{
  "groups": [{
    "name": "default",
    "blocked": [
      "alpha.example" // trailing rationale
    ]
  }]
}`;
    const [comment] = listAdvancedBlockingDomainComments(raw);
    const edited = mutateAdvancedBlockingDomainComment(raw, {
      action: "edit",
      commentId: comment.id,
      text: "updated trailing rationale",
    });
    const [editedComment] = listAdvancedBlockingDomainComments(edited);
    const removed = mutateAdvancedBlockingDomainComment(edited, {
      action: "remove",
      commentId: editedComment.id,
    });

    expect(edited).toContain('"alpha.example" // updated trailing rationale');
    expect(removed).toContain('"alpha.example"');
    expect(listAdvancedBlockingDomainComments(removed)).toEqual([]);
  });

  it("atomically combines structured changes with comment edits, removals, and additions", () => {
    const raw = `{
  // root stays canonical
  "localEndPointGroupMap": {},
  "networkGroupMap": {},
  "groups": [{
    "name": "default",
    "blockingAddresses": [],
    "allowed": [],
    "blocked": [
      // remove with alpha
      "alpha.example",
      // update with beta
      "beta.example"
    ],
    "allowListUrls": [],
    "blockListUrls": [],
    "allowedRegex": [],
    "blockedRegex": [],
    "regexAllowListUrls": [],
    "regexBlockListUrls": [],
    "adblockListUrls": []
  }]
}`;
    const comments = listAdvancedBlockingDomainComments(raw);
    const alpha = comments.find((comment) => comment.value === "alpha.example");
    const beta = comments.find((comment) => comment.value === "beta.example");

    const updated = applyAdvancedBlockingJsoncChanges(
      raw,
      createConfig({
        groups: [
          createGroup({
            blocked: ["beta.example", "gamma.example"],
          }),
        ],
      }),
      [
        { action: "remove", commentId: alpha!.id },
        {
          action: "edit",
          commentId: beta!.id,
          text: "updated beta rationale",
        },
        {
          action: "add",
          groupName: "default",
          field: "blocked",
          value: "gamma.example",
          occurrence: 0,
          text: "new gamma rationale",
          style: "block",
        },
      ],
    );

    expect(updated).toContain("// root stays canonical");
    expect(updated).not.toContain("alpha.example");
    expect(updated).not.toContain("remove with alpha");
    expect(updated).toContain("// updated beta rationale");
    expect(updated).toContain("/* new gamma rationale */");
    expect(parseAdvancedBlockingJsonc(updated)).toMatchObject({
      groups: [{ blocked: ["beta.example", "gamma.example"] }],
    });
  });
});
