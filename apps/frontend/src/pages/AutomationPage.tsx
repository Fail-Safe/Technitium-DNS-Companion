import { useTechnitiumState } from "../context/useTechnitiumState";

export function AutomationPage() {
  const { nodes } = useTechnitiumState();

  return (
    <section className="automation">
      <header className="automation__header">
        <h1>Automation</h1>
        <p>
          Define scheduled jobs and policy-driven actions to keep Technitium DNS
          nodes in sync without manual intervention. This area will house
          recurring job builders, diff alerts, and approval workflows.
        </p>
      </header>
      <section className="automation__content">
        <article className="automation__card">
          <h2>Coming Soon</h2>
          <p>
            Automation playbooks will target all connected nodes. Current
            inventory: <strong>{nodes.length}</strong> node
            {nodes.length === 1 ? "" : "s"} ready for orchestration.
          </p>
          <p>
            Expect schedulers for dry-runs, enforcement windows for apply
            operations, and hooks for custom notifications.
          </p>
        </article>
      </section>
    </section>
  );
}

export default AutomationPage;
