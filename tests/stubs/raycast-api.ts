/**
 * Stand-in for @raycast/api under vitest. The npm package ships types only; the runtime exists inside the Raycast app.
 * Exports every name @raycast/utils imports, with real values only for what usePromise reads at call time.
 */
export const environment = { launchType: "userInitiated", isDevelopment: true, supportPath: "", assetsPath: "" };
export const LaunchType = { UserInitiated: "userInitiated", Background: "background" };
export const Toast = { Style: { Animated: "animated", Success: "success", Failure: "failure" } };
export async function showToast() {
  return { hide() {} };
}
export const Color = {
  Blue: "raycast-blue",
  Green: "raycast-green",
  Magenta: "raycast-magenta",
  Orange: "raycast-orange",
  Purple: "raycast-purple",
  Red: "raycast-red",
  Yellow: "raycast-yellow",
  PrimaryText: "raycast-primary-text",
  SecondaryText: "raycast-secondary-text",
};
export const Action = undefined;
export const ActionPanel = undefined;
export const AI = undefined;
export const Cache = undefined;
export const Clipboard = undefined;
export const Icon = undefined;
export const List = undefined;
export const LocalStorage = undefined;
export const MenuBarExtra = undefined;
export const OAuth = undefined;
export const open = undefined;
