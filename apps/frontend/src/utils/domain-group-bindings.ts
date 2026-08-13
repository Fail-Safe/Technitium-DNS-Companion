import type {
  DomainGroupBindingAction,
  DomainGroupBindingSummary,
} from "../types/domainGroups";

export interface DomainGroupBindingPlan {
  bindingIdsToDelete: string[];
  groupNamesToAdd: string[];
  targetGroupNames: string[];
}

export function planDomainGroupBindings(
  bindings: DomainGroupBindingSummary[],
  domainGroupId: string,
  targetGroupNames: string[],
  action: DomainGroupBindingAction,
): DomainGroupBindingPlan {
  const uniqueTargets = new Map<string, string>();
  for (const groupName of targetGroupNames) {
    const normalizedName = groupName.trim();
    if (
      normalizedName &&
      !uniqueTargets.has(normalizedName.toLowerCase())
    ) {
      uniqueTargets.set(normalizedName.toLowerCase(), normalizedName);
    }
  }

  const bindingIdsToDelete: string[] = [];
  const groupNamesToAdd: string[] = [];

  for (const [targetNameLower, targetName] of uniqueTargets) {
    const targetBindings = bindings.filter(
      (binding) =>
        binding.domainGroupId === domainGroupId &&
        binding.advancedBlockingGroupName.toLowerCase() === targetNameLower,
    );

    const hasRequestedBinding = targetBindings.some(
      (binding) => binding.action === action,
    );
    bindingIdsToDelete.push(
      ...targetBindings
        .filter((binding) => binding.action !== action)
        .map((binding) => binding.bindingId),
    );

    if (!hasRequestedBinding) {
      groupNamesToAdd.push(targetName);
    }
  }

  return {
    bindingIdsToDelete,
    groupNamesToAdd,
    targetGroupNames: [...uniqueTargets.values()],
  };
}
