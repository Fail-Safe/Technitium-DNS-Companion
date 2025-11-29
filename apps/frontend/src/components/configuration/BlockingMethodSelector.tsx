import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faShield, faCubes, faChevronDown } from '@fortawesome/free-solid-svg-icons';
import type { BlockingMethod } from '../../types/builtInBlocking';
import './BlockingMethodSelector.css';

interface BlockingMethodSelectorProps {
    selectedMethod: BlockingMethod;
    onMethodChange: (method: BlockingMethod) => void;
    hasAdvancedBlocking: boolean;
    hasBuiltInBlocking: boolean;
    disabled?: boolean;
}

export function BlockingMethodSelector({
    selectedMethod,
    onMethodChange,
    hasAdvancedBlocking,
    hasBuiltInBlocking,
    disabled = false,
}: BlockingMethodSelectorProps) {
    return (
        <div className="blocking-method-selector">
            <label className="blocking-method-selector__label">Blocking Method:</label>
            <div className="blocking-method-selector__dropdown">
                <select
                    value={selectedMethod}
                    onChange={(e) => onMethodChange(e.target.value as BlockingMethod)}
                    disabled={disabled}
                    className="blocking-method-selector__select"
                >
                    <option value="advanced">
                        Advanced Blocking {!hasAdvancedBlocking && '(Not Installed)'}
                    </option>
                    <option value="built-in">
                        Built-in Blocking {!hasBuiltInBlocking && '(Disabled)'}
                    </option>
                </select>
                <FontAwesomeIcon icon={faChevronDown} className="blocking-method-selector__chevron" />
            </div>
            <div className="blocking-method-selector__info">
                {selectedMethod === 'advanced' ? (
                    <span className="blocking-method-selector__info-item">
                        <FontAwesomeIcon icon={faCubes} />
                        <span>Per-client/subnet rules, groups, regex patterns, and URLs</span>
                    </span>
                ) : (
                    <span className="blocking-method-selector__info-item">
                        <FontAwesomeIcon icon={faShield} />
                        <span>Simple allow/block domain lists</span>
                    </span>
                )}
            </div>
        </div>
    );
}
