import { describe, expect, it } from "bun:test";
import { mapStage } from "./stage";

describe("mapStage precedence", () => {
  it("archived/deleted -> IDLE/dim", () => {
    expect(mapStage({ archived: true })).toEqual({ state: "IDLE", severity: "dim" });
    expect(mapStage({ deleted: true })).toEqual({ state: "IDLE", severity: "dim" });
  });
  it("perm+busy -> BLOCKED/amber", () => {
    expect(mapStage({ permissionPending: true, busy: true })).toEqual({
      state: "BLOCKED",
      severity: "amber",
    });
  });
  it("error/retry -> BLOCKED/red", () => {
    expect(mapStage({ error: true })).toEqual({ state: "BLOCKED", severity: "red" });
    expect(mapStage({ retry: true })).toEqual({ state: "BLOCKED", severity: "red" });
  });
  it("perm alone -> BLOCKED/amber", () => {
    expect(mapStage({ permissionPending: true })).toEqual({
      state: "BLOCKED",
      severity: "amber",
    });
  });
  it("toolRunning||busy -> BUILD/green", () => {
    expect(mapStage({ toolRunning: true })).toEqual({ state: "BUILD", severity: "green" });
    expect(mapStage({ busy: true })).toEqual({ state: "BUILD", severity: "green" });
  });
  it("questionPending -> GATE/amber", () => {
    expect(mapStage({ questionPending: true })).toEqual({ state: "GATE", severity: "amber" });
  });
  it("diff+idle -> REVIEW/bright", () => {
    expect(mapStage({ diffNonEmpty: true, idle: true })).toEqual({
      state: "REVIEW",
      severity: "bright",
    });
  });
  it("todosActive -> BUILD/green", () => {
    expect(mapStage({ todosActive: true })).toEqual({ state: "BUILD", severity: "green" });
  });
  it("todosProposed -> PLAN/mid", () => {
    expect(mapStage({ todosProposed: true })).toEqual({ state: "PLAN", severity: "mid" });
  });
  it("idle -> IDLE/dim", () => {
    expect(mapStage({ idle: true })).toEqual({ state: "IDLE", severity: "dim" });
  });
  it("default -> SPEC/cyan", () => {
    expect(mapStage({})).toEqual({ state: "SPEC", severity: "cyan" });
  });
  it("conflict perm+busy+error -> amber (perm+busy wins)", () => {
    expect(
      mapStage({ permissionPending: true, busy: true, error: true }),
    ).toEqual({ state: "BLOCKED", severity: "amber" });
  });
  it("conflict tool+question -> BUILD", () => {
    expect(mapStage({ toolRunning: true, questionPending: true })).toEqual({
      state: "BUILD",
      severity: "green",
    });
  });
  it("conflict diff+idle+todosProposed -> REVIEW", () => {
    expect(
      mapStage({ diffNonEmpty: true, idle: true, todosProposed: true }),
    ).toEqual({ state: "REVIEW", severity: "bright" });
  });
  it("conflict archived+error -> IDLE", () => {
    expect(mapStage({ archived: true, error: true })).toEqual({
      state: "IDLE",
      severity: "dim",
    });
  });
  it("bare diffNonEmpty -> SPEC", () => {
    expect(mapStage({ diffNonEmpty: true })).toEqual({ state: "SPEC", severity: "cyan" });
  });
  it("empty busy -> BUILD", () => {
    expect(mapStage({ busy: true })).toEqual({ state: "BUILD", severity: "green" });
  });
  it("empty idle -> IDLE", () => {
    expect(mapStage({ idle: true })).toEqual({ state: "IDLE", severity: "dim" });
  });
});
