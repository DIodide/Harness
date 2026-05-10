/** Keep in sync with FastAPI chat route validation. */
export const CHAT_INPUT_MAX_LENGTH = 16000;

/** Show the character counter once the input crosses this fraction of the cap. */
export const CHAT_INPUT_COUNTER_THRESHOLD = Math.floor(
	CHAT_INPUT_MAX_LENGTH * 0.8,
);
