import { NATS } from "nats";
import Timer from "timer";
import config from "mc/config";

const address = config.nats?.address ?? "127.0.0.1"
const port = config.nats?.port ?? 4222
const client = new NATS({
	address,
	port, 
})

client.onConnect = () => {
	trace("connected\n");

	let count = 0
	client.subscribe("echo", (msg) => {
		try {
			const data = JSON.parse(msg.data)
			trace(`got echo: ${data?.count}\n`)
		} catch {
			trace("failed to parse message")
		}
	})
	Timer.repeat(() => {
	trace(`send echo: ${count}\n`);
		client.publish("echo", { count: count++ });
	}, 33)
};
