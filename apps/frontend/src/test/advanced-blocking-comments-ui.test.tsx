import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AdvancedBlockingDomainComments } from "../components/configuration/AdvancedBlockingDomainComments";
import type { AdvancedBlockingStagedCommentChange } from "../components/configuration/AdvancedBlockingDomainComments";
import { AdvancedBlockingJsoncEditor } from "../components/configuration/AdvancedBlockingJsoncEditor";
import type {
  AdvancedBlockingCommentMutation,
  AdvancedBlockingRawConfig,
} from "../types/advancedBlocking";

const rawConfig: AdvancedBlockingRawConfig = {
  nodeId: "node1",
  rawConfig: `{
  "groups": [{
    "name": "default",
    "blocked": [
      // original rationale
      "ads.example"
    ]
  }]
}`,
  configRevision: "revision-1",
  domainComments: [
    {
      id: "comment-1",
      groupName: "default",
      field: "blocked",
      value: "ads.example",
      occurrence: 0,
      placement: "leading",
      style: "line",
      text: "original rationale",
      raw: "// original rationale",
    },
  ],
};

describe("Advanced Blocking comment UI", () => {
  it("stages edits and removals without committing them", async () => {
    const user = userEvent.setup();
    const onStage = vi.fn();

    render(
      <AdvancedBlockingDomainComments
        domain="ads.example"
        field="blocked"
        groupNames={["default"]}
        rawConfig={rawConfig}
        stagedChanges={[]}
        onClose={vi.fn()}
        onStage={onStage}
        onUnstage={vi.fn()}
      />,
    );

    expect(screen.getByText("// original rationale")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const editor = screen.getByLabelText("Edit comment for default");
    await user.clear(editor);
    await user.type(editor, "updated rationale");
    await user.click(screen.getByRole("button", { name: "Stage edit" }));

    await waitFor(() =>
      expect(onStage).toHaveBeenNthCalledWith(1, [
        {
          action: "edit",
          commentId: "comment-1",
          text: "updated rationale",
        },
      ]),
    );

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(onStage).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Stage removal" }));
    await waitFor(() =>
      expect(onStage).toHaveBeenNthCalledWith(2, [
        {
          action: "remove",
          commentId: "comment-1",
        },
      ]),
    );
  });

  it("stages one add operation for each selected group", async () => {
    const user = userEvent.setup();
    const onStage = vi.fn();

    render(
      <AdvancedBlockingDomainComments
        domain="ads.example"
        field="blocked"
        groupNames={["default", "children"]}
        rawConfig={{ ...rawConfig, domainComments: [] }}
        stagedChanges={[]}
        onClose={vi.fn()}
        onStage={onStage}
        onUnstage={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("checkbox", { name: "children" }),
    );
    await user.type(
      screen.getByPlaceholderText("Why this domain entry exists"),
      "requested by policy",
    );
    await user.click(
      screen.getByRole("button", { name: "Stage comment for 2 groups" }),
    );

    await waitFor(() =>
      expect(onStage).toHaveBeenCalledWith([
        {
          action: "add",
          groupName: "default",
          field: "blocked",
          value: "ads.example",
          occurrence: 0,
          text: "requested by policy",
          style: "line",
        },
        {
          action: "add",
          groupName: "children",
          field: "blocked",
          value: "ads.example",
          occurrence: 0,
          text: "requested by policy",
          style: "line",
        },
      ]),
    );
  });

  it("renders and can undo a pending comment addition", async () => {
    const user = userEvent.setup();
    const onUnstage = vi.fn();
    const stagedChanges: AdvancedBlockingStagedCommentChange[] = [
      {
        id: "pending-1",
        mutation: {
          action: "add",
          groupName: "default",
          field: "blocked",
          value: "ads.example",
          occurrence: 0,
          text: "pending rationale",
          style: "block",
        },
      },
    ];

    render(
      <AdvancedBlockingDomainComments
        domain="ads.example"
        field="blocked"
        groupNames={["default"]}
        rawConfig={{ ...rawConfig, domainComments: [] }}
        stagedChanges={stagedChanges}
        onClose={vi.fn()}
        onStage={vi.fn(
          (_mutations: AdvancedBlockingCommentMutation[]) => undefined,
        )}
        onUnstage={onUnstage}
      />,
    );

    expect(screen.getByText("Pending add")).toBeInTheDocument();
    expect(screen.getByText("/* pending rationale */")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Undo pending change" }),
    );
    expect(onUnstage).toHaveBeenCalledWith("pending-1");
  });

  it("keeps the saved comment visible while showing an edit as pending", () => {
    render(
      <AdvancedBlockingDomainComments
        domain="ads.example"
        field="blocked"
        groupNames={["default"]}
        rawConfig={rawConfig}
        stagedChanges={[
          {
            id: "comment-comment-1",
            mutation: {
              action: "edit",
              commentId: "comment-1",
              text: "pending first line\npending second line",
            },
          },
        ]}
        onClose={vi.fn()}
        onStage={vi.fn()}
        onUnstage={vi.fn()}
      />,
    );

    expect(screen.getByText("// original rationale")).toBeInTheDocument();
    const pendingResult = screen.getByText("Pending result").parentElement;
    expect(pendingResult).toBeInTheDocument();
    expect(pendingResult?.querySelector("pre")?.textContent).toBe(
      "/* pending first line\npending second line */",
    );
    expect(
      screen.getByText(/Comment changes in this dialog are only staged/),
    ).toBeInTheDocument();
  });

  it("prevents an unsafe block-comment delimiter from being staged", async () => {
    const user = userEvent.setup();
    const onStage = vi.fn();
    const blockConfig: AdvancedBlockingRawConfig = {
      ...rawConfig,
      domainComments: [
        {
          ...rawConfig.domainComments[0],
          style: "block",
          raw: "/* original rationale */",
        },
      ],
    };

    render(
      <AdvancedBlockingDomainComments
        domain="ads.example"
        field="blocked"
        groupNames={["default"]}
        rawConfig={blockConfig}
        stagedChanges={[]}
        onClose={vi.fn()}
        onStage={onStage}
        onUnstage={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const editor = screen.getByLabelText("Edit comment for default");
    await user.clear(editor);
    await user.type(editor, "unsafe */ delimiter");

    expect(
      screen.getByText('Block comment text cannot contain "*/".'),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stage edit" })).toBeDisabled();
    expect(onStage).not.toHaveBeenCalled();
  });

  it("saves exact raw JSONC with its loaded revision", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockImplementation(
      async (updatedRaw: string): Promise<AdvancedBlockingRawConfig> => ({
        ...rawConfig,
        rawConfig: updatedRaw,
        configRevision: "revision-2",
      }),
    );

    render(
      <AdvancedBlockingJsoncEditor
        config={rawConfig}
        loading={false}
        onDirtyChange={vi.fn()}
        onReload={vi.fn()}
        onSave={onSave}
      />,
    );

    const editor = screen.getByLabelText("Advanced Blocking raw JSONC");
    await user.type(editor, "\n// final note");
    await user.click(screen.getByRole("button", { name: "Validate & Save" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.stringContaining("// final note"),
        "revision-1",
      ),
    );
    expect(
      await screen.findByText("Advanced Blocking JSONC saved."),
    ).toBeInTheDocument();
  });
});
