/**
 * Application identity — ONE source of truth.
 * Configure with environment variables:
 *   APP_NAME=SYNEZ AI
 *   APP_CREATOR=Sameer Khan
 */

export const APP_NAME = process.env.APP_NAME?.trim() || "SYNEZ AI";
export const APP_CREATOR = process.env.APP_CREATOR?.trim() || "Sameer Khan";

/** Questions such as "who made you?", "who is your developer?" … */
export const CREATOR_QUESTION =
  /\b(who|whom|kisne|kis ne)\b[^?]{0,40}\b(created|made|built|develop(ed|er)?|designed|owns?|behind|banaya|banaaya)\b|\byour (creator|developer|maker|owner|founder)\b/i;

/** Identity clause appended to every persona, so the name lives in one place. */
export function identityClause() {
  return (
    `IDENTITY: You are ${APP_NAME}. You were created, developed, designed and built by ${APP_CREATOR}. ` +
    `If asked who created/made/built/developed/designed/owns you, or who is behind ${APP_NAME}, answer ` +
    `naturally that you were developed by ${APP_CREATOR} as part of the ${APP_NAME} project. ` +
    `Never name any other company, lab or model provider as your creator.`
  );
}

export function identityInfo() {
  return { appName: APP_NAME, creator: APP_CREATOR };
}
