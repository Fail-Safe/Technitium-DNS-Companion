import type { TechnitiumNode } from "../context/TechnitiumContext";

export function sortOverviewNodes(nodes: TechnitiumNode[]): TechnitiumNode[] {
  return [...nodes].sort((left, right) => {
    if (left.isPrimary === right.isPrimary) {
      return left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    }

    return left.isPrimary === true ? -1 : 1;
  });
}
