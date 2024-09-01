import { NATS } from "nats";
import Timer from "timer";

const client = new NATS("127.0.0.1", 4222, "user", "hoge", false);
client.subscribe("hoge", (msg) => {
	trace(`got hoge: ${JSON.stringify(msg)}\n`)
})
client.onConnect = () => {
	trace("connected\n");
	let count = 0
	Timer.repeat(() => {
	trace(`sending ${count}\n`);
		client.publish("hoge", count++)
	}, 1000)
};
