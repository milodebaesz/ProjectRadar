import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProjectMeta } from "../types";

const saveProjectMeta = vi.fn<(meta: ProjectMeta) => Promise<void>>();
let loggedIn = true;

vi.mock("./sync", () => ({ saveProjectMeta: (m: ProjectMeta) => saveProjectMeta(m) }));
vi.mock("./pocketbase", () => ({ isLoggedIn: () => loggedIn }));

const { queueProjectMeta, flushProjectMeta, hasPendingProjectMeta, setCloudSaveErrorHandler } =
  await import("./cloudSave");

function meta(key: string, description: string): ProjectMeta {
  return { key, description };
}

describe("cloudSave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveProjectMeta.mockReset();
    saveProjectMeta.mockResolvedValue(undefined);
    setCloudSaveErrorHandler(() => {});
    loggedIn = true;
  });

  afterEach(async () => {
    await flushProjectMeta();
    vi.useRealTimers();
  });

  it("bundelt snel opeenvolgende bewerkingen tot één write met de laatste stand", async () => {
    // Dit is de bug: typen in het detailscherm gaf één PATCH per toetsaanslag.
    for (const text of ["D", "De", "Dem", "Demo"]) queueProjectMeta(meta("demo", text));
    expect(saveProjectMeta).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(600);
    expect(saveProjectMeta).toHaveBeenCalledTimes(1);
    expect(saveProjectMeta.mock.calls[0][0].description).toBe("Demo");
  });

  it("houdt projecten uit elkaar in plaats van ze te laten verdringen", async () => {
    queueProjectMeta(meta("een", "a"));
    queueProjectMeta(meta("twee", "b"));

    await vi.advanceTimersByTimeAsync(600);
    expect(saveProjectMeta).toHaveBeenCalledTimes(2);
    expect(saveProjectMeta.mock.calls.map((c) => c[0].key).sort()).toEqual(["een", "twee"]);
  });

  it("flush schrijft meteen weg zonder op de debounce te wachten", async () => {
    queueProjectMeta(meta("demo", "Demo"));
    await flushProjectMeta();

    expect(saveProjectMeta).toHaveBeenCalledTimes(1);
    expect(hasPendingProjectMeta()).toBe(false);

    // De afgebroken timer mag daarna geen tweede write meer afvuren.
    await vi.advanceTimersByTimeAsync(600);
    expect(saveProjectMeta).toHaveBeenCalledTimes(1);
  });

  it("doet niets zonder login — dan is er geen cloud om naartoe te schrijven", async () => {
    loggedIn = false;
    queueProjectMeta(meta("demo", "Demo"));

    expect(hasPendingProjectMeta()).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    expect(saveProjectMeta).not.toHaveBeenCalled();
  });

  it("meldt een mislukte write en blijft daarna gewoon werken", async () => {
    const errors: unknown[] = [];
    setCloudSaveErrorHandler((e) => errors.push(e));
    saveProjectMeta.mockRejectedValueOnce(new Error("offline"));

    queueProjectMeta(meta("demo", "Demo"));
    await vi.advanceTimersByTimeAsync(600);
    expect(errors).toHaveLength(1);

    queueProjectMeta(meta("demo", "Demo 2"));
    await vi.advanceTimersByTimeAsync(600);
    expect(saveProjectMeta).toHaveBeenCalledTimes(2);
    expect(errors).toHaveLength(1);
  });
});
