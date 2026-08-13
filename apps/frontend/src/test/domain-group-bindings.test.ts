import { describe, expect, it } from "vitest";
import type { DomainGroupBindingSummary } from "../types/domainGroups";
import { planDomainGroupBindings } from "../utils/domain-group-bindings";

const binding = (
  overrides: Partial<DomainGroupBindingSummary>,
): DomainGroupBindingSummary => ({
  bindingId: "binding-1",
  domainGroupId: "domain-group-1",
  domainGroupName: "Streaming",
  advancedBlockingGroupName: "Family",
  action: "block",
  ...overrides,
});

describe("Domain Group binding plans", () => {
  it("adds a new Domain Group binding to every target group", () => {
    expect(
      planDomainGroupBindings(
        [],
        "domain-group-1",
        ["Family", "Guests"],
        "block",
      ),
    ).toEqual({
      bindingIdsToDelete: [],
      groupNamesToAdd: ["Family", "Guests"],
      targetGroupNames: ["Family", "Guests"],
    });
  });

  it("preserves matching bindings and only adds missing groups", () => {
    expect(
      planDomainGroupBindings(
        [binding({})],
        "domain-group-1",
        ["Family", "Guests"],
        "block",
      ),
    ).toEqual({
      bindingIdsToDelete: [],
      groupNamesToAdd: ["Guests"],
      targetGroupNames: ["Family", "Guests"],
    });
  });

  it("replaces opposite bindings before adding the requested action", () => {
    expect(
      planDomainGroupBindings(
        [binding({ bindingId: "allow-binding", action: "allow" })],
        "domain-group-1",
        ["Family"],
        "block",
      ),
    ).toEqual({
      bindingIdsToDelete: ["allow-binding"],
      groupNamesToAdd: ["Family"],
      targetGroupNames: ["Family"],
    });
  });

  it("matches group names case-insensitively and ignores other Domain Groups", () => {
    expect(
      planDomainGroupBindings(
        [
          binding({ advancedBlockingGroupName: "family" }),
          binding({
            bindingId: "other-domain-group-binding",
            domainGroupId: "domain-group-2",
            advancedBlockingGroupName: "Guests",
          }),
        ],
        "domain-group-1",
        ["Family", "Guests", "family"],
        "block",
      ),
    ).toEqual({
      bindingIdsToDelete: [],
      groupNamesToAdd: ["Guests"],
      targetGroupNames: ["Family", "Guests"],
    });
  });
});
