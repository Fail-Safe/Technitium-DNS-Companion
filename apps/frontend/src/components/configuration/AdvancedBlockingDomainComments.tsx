import { useMemo, useState } from "react";
import type {
  AdvancedBlockingCommentMutation,
  AdvancedBlockingDomainComment,
  AdvancedBlockingDomainListField,
  AdvancedBlockingRawConfig,
} from "../../types/advancedBlocking";
import { AppInput } from "../common/AppInput";

export interface AdvancedBlockingStagedCommentChange {
  id: string;
  mutation: AdvancedBlockingCommentMutation;
}

interface AdvancedBlockingDomainCommentsProps {
  domain: string;
  field: AdvancedBlockingDomainListField;
  groupNames: string[];
  rawConfig: AdvancedBlockingRawConfig;
  stagedChanges: AdvancedBlockingStagedCommentChange[];
  onClose: () => void;
  onStage: (mutations: AdvancedBlockingCommentMutation[]) => void;
  onUnstage: (changeId: string) => void;
}

function formatComment(
  text: string,
  style: AdvancedBlockingDomainComment["style"],
): string {
  const trimmed = text.trim();
  return style === "block" || /[\r\n]/.test(trimmed)
    ? `/* ${trimmed} */`
    : `// ${trimmed}`;
}

function getCommentValidationError(
  text: string,
  style: AdvancedBlockingDomainComment["style"],
): string | undefined {
  const usesBlockStyle = style === "block" || /[\r\n]/.test(text);
  return usesBlockStyle && text.includes("*/")
    ? 'Block comment text cannot contain "*/".'
    : undefined;
}

export function AdvancedBlockingDomainComments({
  domain,
  field,
  groupNames,
  rawConfig,
  stagedChanges,
  onClose,
  onStage,
  onUnstage,
}: AdvancedBlockingDomainCommentsProps) {
  const comments = useMemo(
    () =>
      rawConfig.domainComments.filter(
        (comment) => comment.field === field && comment.value === domain,
      ),
    [rawConfig.domainComments, field, domain],
  );
  const changesByCommentId = useMemo(() => {
    const result = new Map<
      string,
      AdvancedBlockingStagedCommentChange
    >();
    for (const change of stagedChanges) {
      if (change.mutation.action !== "add") {
        result.set(change.mutation.commentId, change);
      }
    }
    return result;
  }, [stagedChanges]);
  const pendingAdds = useMemo(
    () =>
      stagedChanges.filter(
        (
          change,
        ): change is AdvancedBlockingStagedCommentChange & {
          mutation: Extract<
            AdvancedBlockingCommentMutation,
            { action: "add" }
          >;
        } =>
          change.mutation.action === "add" &&
          change.mutation.field === field &&
          change.mutation.value === domain,
      ),
    [stagedChanges, field, domain],
  );
  const [addGroups, setAddGroups] = useState<string[]>(
    groupNames[0] ? [groupNames[0]] : [],
  );
  const [addText, setAddText] = useState("");
  const [addStyle, setAddStyle] = useState<"line" | "block">("line");
  const [editingId, setEditingId] = useState<string>();
  const [editingText, setEditingText] = useState("");
  const [removingId, setRemovingId] = useState<string>();
  const addValidationError = getCommentValidationError(addText, addStyle);

  const stageAdds = () => {
    if (addValidationError) {
      return;
    }
    onStage(
      addGroups.map((groupName) => ({
        action: "add",
        groupName,
        field,
        value: domain,
        occurrence: 0,
        text: addText,
        style: addStyle,
      })),
    );
    setAddText("");
  };

  return (
    <div className="modal-overlay" role="presentation">
      <div
        className="modal-container advanced-blocking-comments"
        role="dialog"
        aria-modal="true"
        aria-labelledby="advanced-blocking-comments-title"
      >
        <header className="advanced-blocking-comments__header">
          <div>
            <h3 id="advanced-blocking-comments-title">Domain comments</h3>
            <code>{domain}</code>
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="alert-box alert-box--info">
          Comment changes in this dialog are only staged. Close the dialog and
          use <strong>Save Changes</strong> to write them to Technitium.
        </div>

        <div className="advanced-blocking-comments__list">
          {comments.length === 0 && pendingAdds.length === 0 && (
            <p className="advanced-blocking-comments__empty">
              No comments are attached to this entry.
            </p>
          )}
          {comments.map((comment) => {
            const staged = changesByCommentId.get(comment.id);
            const isPendingRemoval = staged?.mutation.action === "remove";
            const editingValidationError =
              editingId === comment.id
                ? getCommentValidationError(editingText, comment.style)
                : undefined;

            return (
              <article
                key={comment.id}
                className={`advanced-blocking-comments__item${isPendingRemoval ? " advanced-blocking-comments__item--pending-removal" : ""}`}
              >
                <div className="advanced-blocking-comments__meta">
                  <strong>{comment.groupName}</strong>
                  <span>{comment.placement}</span>
                  <span>{comment.style}</span>
                  {staged && (
                    <span className="advanced-blocking-comments__pending">
                      Pending {staged.mutation.action}
                    </span>
                  )}
                </div>
                {editingId === comment.id ? (
                  <>
                    <textarea
                      value={editingText}
                      onChange={(event) => setEditingText(event.target.value)}
                      aria-label={`Edit comment for ${comment.groupName}`}
                    />
                    {editingValidationError && (
                      <span
                        className="advanced-blocking-comments__validation-error"
                        role="alert"
                      >
                        {editingValidationError}
                      </span>
                    )}
                    <div className="advanced-blocking-comments__item-actions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setEditingId(undefined)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="primary"
                        disabled={
                          !editingText.trim() || Boolean(editingValidationError)
                        }
                        onClick={() => {
                          onStage([
                            {
                              action: "edit",
                              commentId: comment.id,
                              text: editingText,
                            },
                          ]);
                          setEditingId(undefined);
                        }}
                      >
                        Stage edit
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <pre>{comment.raw}</pre>
                    {staged?.mutation.action === "edit" && (
                      <div className="advanced-blocking-comments__pending-result">
                        <strong>Pending result</strong>
                        <pre>
                          {formatComment(
                            staged.mutation.text,
                            comment.style,
                          )}
                        </pre>
                      </div>
                    )}
                    <div className="advanced-blocking-comments__item-actions">
                      {staged ? (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => onUnstage(staged.id)}
                        >
                          Undo pending change
                        </button>
                      ) : removingId === comment.id ? (
                        <>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => setRemovingId(undefined)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => {
                              onStage([
                                {
                                  action: "remove",
                                  commentId: comment.id,
                                },
                              ]);
                              setRemovingId(undefined);
                            }}
                          >
                            Stage removal
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => {
                              setEditingId(comment.id);
                              setEditingText(comment.text);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => setRemovingId(comment.id)}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </article>
            );
          })}
          {pendingAdds.map((change) => (
            <article
              key={change.id}
              className="advanced-blocking-comments__item"
            >
              <div className="advanced-blocking-comments__meta">
                <strong>{change.mutation.groupName}</strong>
                <span>leading</span>
                <span>{change.mutation.style ?? "line"}</span>
                <span className="advanced-blocking-comments__pending">
                  Pending add
                </span>
              </div>
              <pre>
                {formatComment(
                  change.mutation.text,
                  change.mutation.style ?? "line",
                )}
              </pre>
              <div className="advanced-blocking-comments__item-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => onUnstage(change.id)}
                >
                  Undo pending change
                </button>
              </div>
            </article>
          ))}
        </div>

        <section className="advanced-blocking-comments__add">
          <h4>Add comment</h4>
          <fieldset className="advanced-blocking-comments__groups">
            <legend>Groups</legend>
            <div className="advanced-blocking-comments__group-actions">
              <button
                type="button"
                className="secondary"
                disabled={addGroups.length === groupNames.length}
                onClick={() => setAddGroups(groupNames)}
              >
                Select all
              </button>
              <button
                type="button"
                className="secondary"
                disabled={addGroups.length === 0}
                onClick={() => setAddGroups([])}
              >
                Clear
              </button>
            </div>
            <div className="advanced-blocking-comments__group-options">
              {groupNames.map((groupName) => (
                <label key={groupName}>
                  <input
                    type="checkbox"
                    checked={addGroups.includes(groupName)}
                    onChange={(event) =>
                      setAddGroups((current) =>
                        event.target.checked
                          ? [...current, groupName]
                          : current.filter(
                              (selected) => selected !== groupName,
                            ),
                      )
                    }
                  />
                  <span>{groupName}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="advanced-blocking-comments__comment-row">
            <AppInput
              value={addText}
              onChange={(event) => setAddText(event.target.value)}
              placeholder="Why this domain entry exists"
              aria-label="Comment text"
            />
            <label>
              Style
              <select
                value={addStyle}
                onChange={(event) =>
                  setAddStyle(event.target.value as "line" | "block")
                }
              >
                <option value="line">Line comment</option>
                <option value="block">Block comment</option>
              </select>
            </label>
          </div>
          {addValidationError && (
            <span
              className="advanced-blocking-comments__validation-error"
              role="alert"
            >
              {addValidationError}
            </span>
          )}
          <button
            type="button"
            className="primary"
            disabled={
              addGroups.length === 0 ||
              !addText.trim() ||
              Boolean(addValidationError)
            }
            onClick={stageAdds}
          >
            Stage comment for{" "}
            {addGroups.length === 1
              ? "1 group"
              : `${addGroups.length} groups`}
          </button>
        </section>
      </div>
    </div>
  );
}
