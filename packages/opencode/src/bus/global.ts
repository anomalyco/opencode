import { EventEmitter } from "events";

export const GlobalBus = new EventEmitter<{
	event: [
		{
			/** @deprecated use projectID */
			directory?: string
			projectID?: string
			payload: any
		},
	]
}>()
