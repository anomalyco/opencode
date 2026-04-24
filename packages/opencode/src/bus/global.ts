import { EventEmitter } from "events";

export const GlobalBus = new EventEmitter<{
	event: [
		{
			projectID: string
			payload: any
		},
	]
}>()
