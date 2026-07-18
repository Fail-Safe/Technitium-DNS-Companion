import { FUTURE_MINIMUM_TECHNITIUM_VERSION } from "../../utils/technitium-version-support";
import "./TechnitiumVersionDeprecationBanner.css";

export interface DeprecatedTechnitiumNode {
  id: string;
  name: string;
  version: string;
}

export function TechnitiumVersionDeprecationBanner({
  nodes,
}: {
  nodes: DeprecatedTechnitiumNode[];
}) {
  if (nodes.length === 0) {
    return null;
  }

  const nodeSummary = nodes
    .map((node) => `${node.name} (${node.version})`)
    .join(", ");

  return (
    <aside
      className="technitium-version-deprecation-banner"
      role="alert"
      aria-labelledby="technitium-version-deprecation-title"
    >
      <div className="technitium-version-deprecation-banner__content">
        <h2 id="technitium-version-deprecation-title">
          Technitium DNS upgrade required before Companion 2.0
        </h2>
        <p>
          Support for Technitium DNS v14 and earlier is deprecated. Upgrade all
          nodes in a cluster together to v{FUTURE_MINIMUM_TECHNITIUM_VERSION} or
          later; the latest Technitium release is recommended.
        </p>
        <p className="technitium-version-deprecation-banner__nodes">
          Affected nodes: {nodeSummary}
        </p>
      </div>
      <a
        className="technitium-version-deprecation-banner__link"
        href="https://github.com/TechnitiumSoftware/DnsServer/blob/master/CHANGELOG.md"
        target="_blank"
        rel="noreferrer"
      >
        Review upgrade notes
      </a>
    </aside>
  );
}
