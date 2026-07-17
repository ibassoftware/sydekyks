export const MISSION_ACTIVITY_EVENT = "sydekyks:mission-activity";

/** Tell the shared activity provider that a command may have created Missions. The provider still
 * reads the authoritative active-Missions endpoint; this event only removes the discovery delay. */
export function notifyMissionActivity(): void {
  window.dispatchEvent(new Event(MISSION_ACTIVITY_EVENT));
}
