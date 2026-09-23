// Run by the offline Jest suite in a separate process to test abrupt exit.
const { writeFileSync } = require("node:fs");
const {
  DnsScheduleRecoveryFixture,
} = require("./dns-schedules-recovery.fixture.ts");
const [dbPath, configPath, phase] = process.argv.slice(2);
const fixture = new DnsScheduleRecoveryFixture(dbPath);
fixture.create();
if (phase === "empty-finalized") {
  const override = fixture.overrides.listOverrides()[0];
  fixture.overrides.updateOverride(override.id, {
    ...override,
    domainEntries: [],
    domainGroupNames: ["dynamic-set"],
  });
  fixture.config.groups[0].allowed.push("outside.test");
}
writeFileSync(configPath, JSON.stringify(fixture.config));
const prepare = fixture.schedules.prepareRecovery.bind(fixture.schedules);
fixture.schedules.prepareRecovery = (...args) => {
  prepare(...args);
  if (phase === "before-dispatch") process.exit(71);
};
fixture.writeHook = () => {
  writeFileSync(configPath, JSON.stringify(fixture.config));
  if (phase === "after-commit") process.exit(71);
};
const finalize = fixture.schedules.finalizeRecovery.bind(fixture.schedules);
fixture.schedules.finalizeRecovery = (...args) => {
  if (phase === "empty-finalized") finalize(...args);
  process.exit(71);
};
fixture.evaluator.runNow(false).then(() => process.exit(72));
