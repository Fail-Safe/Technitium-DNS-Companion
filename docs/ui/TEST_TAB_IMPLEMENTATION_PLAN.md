# TEST Tab Implementation Plan

## Summary
The TEST tab needs comprehensive updates to match the user's requirements from the image and instructions. Due to the size and complexity of the changes, here's the implementation plan:

## Changes Completed ✅
1. Added staged changes tracking state variables (`testStagedConfig`, `testPendingChanges`, etc.)
2. Added edit/delete modal state variables
3. Updated `hasUnsavedTestChanges` to track unsaved changes
4. Updated tab change and node selection warnings to include TEST tab
5. Added initialization useEffect for `testStagedConfig`
6. Rewrote drag handlers to work with domain parameters
7. Updated `handleDrop` to add domains to staged config and track changes
8. Added handlers: `handleTestSave`, `handleTestReset`, `handleEditDomain`, `handleConfirmEdit`, `handleDeleteDomain`, `handleConfirmDelete`

## Changes Needed 🔨
1. Convert domain table rows to draggable badges with color coding
2. Add edit/delete buttons to each domain row
3. Add "All Groups" drop zone at the top of Groups list
4. Make group headers accept drops  (currently working)
5. Make expanded group lists droppable zones
6. Add footer with `multi-group-editor__footer` class showing staged changes
7. Add Save/Reset buttons in footer
8. Add Edit Domain modal
9. Add Delete Domain confirmation modal

## Implementation Strategy

Since the file is very large (1243 lines) and the TEST tab section spans lines ~850-1200, I recommend implementing the remaining changes in these steps:

### Step 1: Update Domain Table Rendering
Replace the table rows (lines ~990-1040) to make domains draggable badges:
- Change from plain text to colored badges (red for blocked, green for allowed)
- Make each badge draggable with `onDragStart={(e) => handleDragStart(e, domain)}`
- Add edit/delete icon buttons next to each badge

### Step 2: Add "All Groups" Drop Zone
Insert before the groups loop (line ~1115):
```tsx
{/* All Groups Drop Zone */}
<div
    onDragOver={(e) => handleDragOver(e, 'ALL_GROUPS')}
    onDragLeave={handleDragLeave}
    onDrop={(e) => handleDrop(e, 'ALL_GROUPS')}
    style={{
        padding: '1rem',
        border: dragOverGroup === 'ALL_GROUPS' ? '2px dashed #365df3' : '2px dashed #cfd6e4',
        borderRadius: '0.75rem',
        background: dragOverGroup === 'ALL_GROUPS' ? '#e9efff' : '#f6f8fb',
        textAlign: 'center',
        marginBottom: '1rem',
    }}
>
    <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>👥</div>
    <div style={{ fontWeight: 600, color: '#365df3' }}>All Groups</div>
    <div style={{ fontSize: '0.8rem', color: '#5d6786' }}>Drop here to add to all groups</div>
</div>
```

### Step 3: Make Expanded Lists Droppable
Update the expanded domain list section (lines ~1160-1180) to be a drop zone:
- Wrap the expanded list in a droppable div
- Add `onDragOver`, `onDrop` handlers

### Step 4: Add Footer
After the TEST tab closing div (line ~1218), before the next tab:
```tsx
{activeTab === 'test' && testStagedConfig && (
    <footer className="multi-group-editor__footer">
        {hasUnsavedTestChanges && (
            <>
                <button
                    type="button"
                    className="multi-group-editor__footer-hint multi-group-editor__footer-hint--clickable"
                    onClick={() => setShowTestChangesSummary(!showTestChangesSummary)}
                >
                    You have unsaved changes ({testPendingChanges.length}) {showTestChangesSummary ? '▼' : '▲'}
                </button>
                {showTestChangesSummary && testPendingChanges.length > 0 && (
                    <div className="multi-group-editor__changes-summary">
                        <h4>Pending Changes:</h4>
                        <ul className="multi-group-editor__changes-list">
                            {testPendingChanges.map((change, idx) => (
                                <li key={idx} className={`change-item change-item--${change.type}`}>
                                    <span className="change-icon">
                                        {change.type === 'added' ? '➕' : change.type === 'removed' ? '➖' : '✏️'}
                                    </span>
                                    <span className="change-type">{change.category}</span>
                                    <span className="change-group">{change.description}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </>
        )}
        <div className="multi-group-editor__footer-actions">
            <button
                type="button"
                className="secondary"
                onClick={handleTestReset}
                disabled={!hasUnsavedTestChanges}
            >
                Reset
            </button>
            <button
                type="button"
                className="primary"
                onClick={() => void handleTestSave()}
                disabled={!hasUnsavedTestChanges || !testStagedConfig}
            >
                Save Changes
            </button>
        </div>
    </footer>
)}
```

### Step 5: Add Modals
At the end of the ConfigurationPage component (before the closing `</>`):
```tsx
{/* Edit Domain Modal */}
{editingDomain && (
    <div className="modal-overlay" onClick={() => setEditingDomain(null)}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Edit Domain</h3>
            <p>Domain is in groups: {editingDomain.groups.join(', ')}</p>
            <input
                type="text"
                value={editDomainInput}
                onChange={(e) => setEditDomainInput(e.target.value)}
                placeholder="Enter new domain"
            />
            <div className="modal-actions">
                <button onClick={() => setEditingDomain(null)}>Cancel</button>
                <button onClick={handleConfirmEdit} disabled={!editDomainInput.trim()}>Save</button>
            </div>
        </div>
    </div>
)}

{/* Delete Domain Modal */}
{deletingDomain && (
    <div className="modal-overlay" onClick={() => setDeletingDomain(null)}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Domain</h3>
            <p>Are you sure you want to delete "{deletingDomain.domain}" from {deletingDomain.groups.length} group(s)?</p>
            <p>Groups: {deletingDomain.groups.join(', ')}</p>
            <div className="modal-actions">
                <button onClick={() => setDeletingDomain(null)}>Cancel</button>
                <button onClick={handleConfirmDelete} className="danger">Delete</button>
            </div>
        </div>
    </div>
)}
```

## Next Steps
Execute these changes in order using targeted `replace_string_in_file` calls.
