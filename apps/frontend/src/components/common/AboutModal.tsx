import { faGithub } from "@fortawesome/free-brands-svg-icons";
import {
  faBalanceScale,
  faBook,
  faChartLine,
  faExternalLinkAlt,
  faTimes,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useLatestRelease } from "../../hooks/useLatestRelease";
import {
  describeBuildChannel,
  formatBuildChannelStatus,
} from "../../utils/build-channel";
import "./AboutModal.css";

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
  const buildRevision =
    __BUILD_REVISION__ === "development" || __BUILD_REVISION__ === "unknown" ?
      null
    : __BUILD_REVISION__.slice(0, 7);
  const {
    latestVersion,
    latestReleaseUrl,
    isChecking,
    isUpdateAvailable,
    error: versionCheckError,
  } = useLatestRelease(__APP_VERSION__);
  const buildChannel = describeBuildChannel(__BUILD_CHANNEL__);
  const buildChannelStatus = formatBuildChannelStatus(
    buildChannel,
    latestVersion,
    Boolean(versionCheckError),
  );

  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div
      className="about-modal__overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-modal-title"
    >
      <div className="about-modal">
        <button
          className="about-modal__close"
          onClick={onClose}
          aria-label="Close about dialog"
        >
          <FontAwesomeIcon icon={faTimes} />
        </button>

        <div className="about-modal__header">
          <img
            className="about-modal__logo"
            src="/icon.svg"
            alt=""
            aria-hidden="true"
          />
          <h2 id="about-modal-title" className="about-modal__title">
            {__APP_NAME__}
          </h2>
          <div className="about-modal__version-row">
            <span className="about-modal__version">v{__APP_VERSION__}</span>
            {buildChannel.badge && (
              <span
                className={`about-modal__channel about-modal__channel--${buildChannel.kind}`}
              >
                {buildChannel.badge}
              </span>
            )}
            {buildRevision && (
              <span
                className="about-modal__revision"
                title={`Build revision ${__BUILD_REVISION__}`}
              >
                {buildRevision}
              </span>
            )}
          </div>
          <div className="about-modal__version-check">
            {buildChannelStatus ?
              <span className="about-modal__version-status about-modal__version-status--preview">
                {buildChannelStatus}
              </span>
            : isUpdateAvailable && latestVersion ?
              <a
                href={
                  latestReleaseUrl ||
                  "https://github.com/Fail-Safe/Technitium-DNS-Companion/releases/latest"
                }
                target="_blank"
                rel="noopener noreferrer"
                className="about-modal__update-pill"
              >
                <span>Update available</span>
                <strong>v{latestVersion}</strong>
              </a>
            : !isChecking && latestVersion ?
              <span className="about-modal__version-status about-modal__version-status--ok">
                You're up to date
              </span>
            : !isChecking && versionCheckError ?
              <span className="about-modal__version-status about-modal__version-status--error">
                Update check unavailable
              </span>
            : null}
          </div>
        </div>

        <p className="about-modal__description">
          A companion web application for managing and synchronizing multiple
          Technitium DNS servers. Features include unified query logs, DNS
          filtering management, DHCP scope synchronization, and zone comparison.
        </p>

        <div className="about-modal__links">
          <a
            href="https://github.com/Fail-Safe/Technitium-DNS-Companion"
            target="_blank"
            rel="noopener noreferrer"
            className="about-modal__link"
          >
            <FontAwesomeIcon icon={faGithub} />
            <span>GitHub Repository</span>
            <FontAwesomeIcon
              icon={faExternalLinkAlt}
              className="about-modal__link-external"
            />
          </a>
          <a
            href="https://fail-safe.github.io/Technitium-DNS-Companion/performance/"
            target="_blank"
            rel="noopener noreferrer"
            className="about-modal__link"
          >
            <FontAwesomeIcon icon={faChartLine} />
            <span>DNS Logs Performance</span>
            <FontAwesomeIcon
              icon={faExternalLinkAlt}
              className="about-modal__link-external"
            />
          </a>
          <a
            href="https://github.com/TechnitiumSoftware/DnsServer"
            target="_blank"
            rel="noopener noreferrer"
            className="about-modal__link"
          >
            <FontAwesomeIcon icon={faGithub} />
            <span>Technitium DNS Server</span>
            <FontAwesomeIcon
              icon={faExternalLinkAlt}
              className="about-modal__link-external"
            />
          </a>
          <a
            href="https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md"
            target="_blank"
            rel="noopener noreferrer"
            className="about-modal__link"
          >
            <FontAwesomeIcon icon={faBook} />
            <span>Technitium API Docs</span>
            <FontAwesomeIcon
              icon={faExternalLinkAlt}
              className="about-modal__link-external"
            />
          </a>
          <a
            href="https://github.com/Fail-Safe/Technitium-DNS-Companion/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            className="about-modal__link"
          >
            <FontAwesomeIcon icon={faBalanceScale} />
            <span>MIT License</span>
            <FontAwesomeIcon
              icon={faExternalLinkAlt}
              className="about-modal__link-external"
            />
          </a>
        </div>

        <div className="about-modal__footer">
          <p>Made with ❤️ for the Technitium DNS community</p>
        </div>
      </div>
    </div>
  );
}
