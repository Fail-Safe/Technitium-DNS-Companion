import { AdvancedBlockingPauseService } from "./advanced-blocking-pause.service";

describe("AdvancedBlockingPauseService", () => {
  const create = () => {
    const pauseState = {
      list: jest.fn(() => []),
      get: jest.fn(),
      beginPause: jest.fn(),
      markActivationPending: jest.fn(),
      markResumePending: jest.fn(),
      remove: jest.fn(),
      migrateLegacyKey: jest.fn(),
      adoptResolvedAnchor: jest.fn(),
      markVerified: jest.fn(),
      requestResume: jest.fn(),
      markVerificationFailed: jest.fn(),
    };
    const advancedBlocking = {
      resolvePauseTarget: jest.fn(),
      activatePauseRoot: jest.fn(),
      verifyPauseRoot: jest.fn(),
      restorePauseRoot: jest.fn(),
    };
    const schedules = { runNow: jest.fn() };
    const technitium = {
      listNodes: jest.fn(),
      getConfiguredNodeGroupId: jest.fn(),
      assertSessionConfigWriteAccess: jest.fn(),
      assertSessionConfigWriteTargets: jest.fn(),
    };
    return {
      service: new AdvancedBlockingPauseService(
        pauseState as never,
        advancedBlocking as never,
        schedules as never,
        technitium as never,
      ),
      pauseState,
      advancedBlocking,
      schedules,
      technitium,
    };
  };

  it("fails closed when no session-visible node has a readable Advanced Blocking root", async () => {
    const { service, technitium, advancedBlocking } = create();
    technitium.listNodes.mockResolvedValue([{ id: "built-in" }]);
    advancedBlocking.verifyPauseRoot.mockRejectedValue(
      new Error("Advanced Blocking is unavailable"),
    );

    await expect(service.pause(15)).rejects.toThrow(
      "No eligible Advanced Blocking targets",
    );
    expect(technitium.assertSessionConfigWriteTargets).not.toHaveBeenCalled();
    expect(advancedBlocking.activatePauseRoot).not.toHaveBeenCalled();
  });
  it("fails closed when the session lacks Apps: Modify on the schedule-resolved Primary", async () => {
    const { service, technitium, advancedBlocking } = create();
    technitium.listNodes.mockResolvedValue([{ id: "dns1" }]);
    advancedBlocking.verifyPauseRoot.mockResolvedValue({
      targetKey: "cluster:default:dns.example",
      writeNodeId: "dns1",
      paused: false,
    });
    advancedBlocking.resolvePauseTarget.mockResolvedValue({
      targetKey: "cluster:default:dns.example",
      writeNodeId: "dns1",
    });
    technitium.assertSessionConfigWriteTargets.mockRejectedValue(
      new Error("forbidden"),
    );
    await expect(service.pause(15)).rejects.toThrow("forbidden");
    expect(advancedBlocking.resolvePauseTarget).toHaveBeenCalledWith(
      "dns1",
      "schedule",
      true,
    );
    expect(technitium.assertSessionConfigWriteTargets).toHaveBeenCalledWith([
      "dns1",
    ]);
    expect(advancedBlocking.activatePauseRoot).not.toHaveBeenCalled();
  });

  it("retains pause ownership when schedule reconciliation reports recovery work", async () => {
    const { service, pauseState, advancedBlocking, schedules } = create();
    schedules.runNow.mockResolvedValue({ errored: 1, pendingRecoveryCount: 0 });
    const target = {
      writeTargetNodeId: "node:primary",
      anchorNodeId: "primary",
      status: "active" as const,
      expiresAt: new Date(0).toISOString(),
      previousEnableBlockingPresent: true,
      previousEnableBlockingValue: true,
      updatedAt: new Date().toISOString(),
    };
    pauseState.get.mockReturnValue(target);
    await (
      service as unknown as { tryResume(value: typeof target): Promise<void> }
    ).tryResume(target);
    expect(advancedBlocking.restorePauseRoot).not.toHaveBeenCalled();
    expect(pauseState.markResumePending).toHaveBeenCalledWith(
      "node:primary",
      expect.stringContaining("incomplete"),
      target.updatedAt,
    );
  });

  it("does not restore when an extension changes durable ownership during reconciliation", async () => {
    const { service, pauseState, advancedBlocking, schedules } = create();
    const target = {
      writeTargetNodeId: "cluster:default:dns.example",
      anchorNodeId: "primary",
      status: "active" as const,
      expiresAt: new Date(0).toISOString(),
      previousEnableBlockingPresent: true,
      previousEnableBlockingValue: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    schedules.runNow.mockResolvedValue({ errored: 0, pendingRecoveryCount: 0 });
    advancedBlocking.restorePauseRoot.mockImplementation(
      (
        _nodeId: string,
        _previous: boolean,
        _mode: string,
        _onRestored: (key: string) => void,
        beforeRestore: (value: {
          targetKey: string;
          writeNodeId: string;
        }) => void,
      ) =>
        beforeRestore({
          targetKey: target.writeTargetNodeId,
          writeNodeId: "primary",
        }),
    );
    pauseState.get.mockReturnValue({
      ...target,
      expiresAt: "2026-01-01T01:00:00.000Z",
      updatedAt: "2026-01-01T00:30:00.000Z",
    });
    await (
      service as unknown as { tryResume(value: typeof target): Promise<void> }
    ).tryResume(target);
    expect(pauseState.remove).not.toHaveBeenCalled();
    expect(pauseState.markResumePending).toHaveBeenCalledWith(
      target.writeTargetNodeId,
      expect.stringContaining("changed"),
      target.updatedAt,
    );
  });
  it("adopts a recovered Primary before canonical-row operations continue", async () => {
    const { service, pauseState, advancedBlocking, technitium } = create();
    const target = {
      writeTargetNodeId: "cluster:group:dns.example",
      anchorNodeId: "former-primary",
      status: "active" as const,
      expiresAt: "2030-01-01T00:00:00.000Z",
      updatedAt: "2029-01-01T00:00:00.000Z",
    };
    advancedBlocking.resolvePauseTarget
      .mockRejectedValueOnce(new Error("former primary unreachable"))
      .mockResolvedValue({
        targetKey: target.writeTargetNodeId,
        writeNodeId: "replacement-primary",
      });
    technitium.getConfiguredNodeGroupId.mockReturnValue("group");
    technitium.listNodes.mockResolvedValue([
      { id: "replacement-primary", groupId: "group" },
    ]);
    const resolved = await (
      service as unknown as {
        resolveDurableTarget(value: typeof target): Promise<typeof target>;
      }
    ).resolveDurableTarget(target);
    expect(pauseState.adoptResolvedAnchor).toHaveBeenCalledWith(
      target.writeTargetNodeId,
      "replacement-primary",
    );
    expect(resolved).toMatchObject({ anchorNodeId: "replacement-primary" });
  });

  it("uses the schedule-resolved Primary even when session topology differs", async () => {
    const { service, pauseState, technitium, advancedBlocking } = create();
    const targets: Array<{
      writeTargetNodeId: string;
      anchorNodeId: string;
      status: "activation-pending" | "active";
      expiresAt: string;
      previousEnableBlockingPresent?: boolean;
      previousEnableBlockingValue?: boolean;
      updatedAt: string;
    }> = [];
    pauseState.list.mockImplementation(() => targets);
    pauseState.get.mockImplementation((targetKey: string) =>
      targets.find((target) => target.writeTargetNodeId === targetKey),
    );
    pauseState.beginPause.mockImplementation(
      (targetKey: string, anchorNodeId: string, expiresAt: string) => {
        targets.push({
          writeTargetNodeId: targetKey,
          anchorNodeId,
          status: "activation-pending",
          expiresAt,
          updatedAt: new Date().toISOString(),
        });
      },
    );
    technitium.listNodes.mockResolvedValue([{ id: "dns1" }]);
    advancedBlocking.verifyPauseRoot.mockResolvedValue({
      targetKey: "cluster:session-view.example",
      writeNodeId: "session-primary",
      paused: false,
    });
    advancedBlocking.resolvePauseTarget.mockResolvedValue({
      targetKey: "cluster:default:dns.example",
      writeNodeId: "dns1",
    });
    advancedBlocking.activatePauseRoot.mockImplementation(
      (
        _nodeId: string,
        _authMode: string,
        beforeActivate: (target: {
          targetKey: string;
          writeNodeId: string;
        }) => void,
      ) => {
        beforeActivate({
          targetKey: "cluster:default:dns.example",
          writeNodeId: "dns1",
        });
        targets[0].status = "active";
        targets[0].previousEnableBlockingPresent = true;
        targets[0].previousEnableBlockingValue = true;
      },
    );

    const result = await service.pause(15);

    expect(advancedBlocking.verifyPauseRoot).toHaveBeenCalledWith(
      "dns1",
      "session",
    );
    expect(technitium.assertSessionConfigWriteTargets).toHaveBeenCalledWith([
      "dns1",
    ]);
    expect(advancedBlocking.resolvePauseTarget).not.toHaveBeenCalledWith(
      "dns1",
      "session",
      true,
    );
    expect(advancedBlocking.activatePauseRoot).toHaveBeenCalledWith(
      "dns1",
      "schedule",
      expect.any(Function),
    );
    expect(result).toMatchObject({
      paused: true,
      confirmedPausedTargetCount: 1,
      pendingTargetCount: 0,
    });
  });

  it("skips an unavailable app while pausing another live enabled root", async () => {
    const { service, technitium, advancedBlocking } = create();
    technitium.listNodes.mockResolvedValue([{ id: "offline" }, { id: "dns1" }]);
    advancedBlocking.verifyPauseRoot
      .mockRejectedValueOnce(new Error("app unavailable"))
      .mockResolvedValueOnce({
        targetKey: "node:dns1",
        writeNodeId: "dns1",
        paused: false,
      });
    advancedBlocking.resolvePauseTarget.mockResolvedValue({
      targetKey: "node:dns1",
      writeNodeId: "dns1",
    });

    await service.pause(15);

    expect(advancedBlocking.resolvePauseTarget).toHaveBeenCalledWith(
      "dns1",
      "schedule",
      true,
    );
    expect(advancedBlocking.activatePauseRoot).toHaveBeenCalledWith(
      "dns1",
      "schedule",
      expect.any(Function),
    );
  });
  it("authorizes the newly schedule-resolved Primary after a failover", async () => {
    const { service, technitium, advancedBlocking } = create();
    technitium.listNodes.mockResolvedValue([{ id: "dns1" }]);
    advancedBlocking.verifyPauseRoot.mockResolvedValue({
      targetKey: "cluster:default:dns.example",
      writeNodeId: "dns1",
      paused: false,
    });
    advancedBlocking.resolvePauseTarget.mockResolvedValue({
      targetKey: "cluster:default:dns.example",
      writeNodeId: "dns2",
    });

    await service.pause(15);

    expect(advancedBlocking.resolvePauseTarget).toHaveBeenCalledWith(
      "dns1",
      "schedule",
      true,
    );
    expect(technitium.assertSessionConfigWriteTargets).toHaveBeenCalledWith([
      "dns2",
    ]);
  });

  it("fails closed when the schedule credential cannot validate a Primary", async () => {
    const { service, technitium, advancedBlocking } = create();
    technitium.listNodes.mockResolvedValue([{ id: "dns1" }]);
    advancedBlocking.verifyPauseRoot.mockResolvedValue({
      targetKey: "cluster:default:dns.example",
      writeNodeId: "dns1",
      paused: false,
    });
    advancedBlocking.resolvePauseTarget.mockRejectedValue(
      new Error("no validated Primary"),
    );

    await expect(service.pause(15)).rejects.toThrow("no validated Primary");
    expect(technitium.assertSessionConfigWriteTargets).not.toHaveBeenCalled();
    expect(advancedBlocking.activatePauseRoot).not.toHaveBeenCalled();
  });

  it("resumes through the current schedule target after exact session admission", async () => {
    const { service, pauseState, technitium, advancedBlocking } = create();
    const target = {
      writeTargetNodeId: "cluster:default:dns.example",
      anchorNodeId: "dns1",
      status: "active" as const,
      expiresAt: "2030-01-01T00:00:00.000Z",
      previousEnableBlockingPresent: true,
      previousEnableBlockingValue: true,
      updatedAt: "2029-01-01T00:00:00.000Z",
    };
    pauseState.list.mockReturnValue([target]);
    pauseState.get.mockReturnValue(target);
    advancedBlocking.resolvePauseTarget.mockResolvedValue({
      targetKey: target.writeTargetNodeId,
      writeNodeId: "dns2",
    });
    const internals = service as unknown as {
      tryResume: jest.MockedFunction<
        (value: typeof target, expectedWriteNodeId?: string) => Promise<void>
      >;
    };
    jest.spyOn(internals, "tryResume").mockResolvedValue();

    await service.resumeNow();

    expect(technitium.assertSessionConfigWriteTargets).toHaveBeenCalledWith([
      "dns2",
    ]);
    expect(advancedBlocking.resolvePauseTarget).toHaveBeenCalledWith(
      "dns1",
      "schedule",
      true,
    );
    expect(internals.tryResume).toHaveBeenCalledWith(
      expect.objectContaining({ writeTargetNodeId: target.writeTargetNodeId }),
      "dns2",
    );
  });
});
