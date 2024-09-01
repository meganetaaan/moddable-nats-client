import TLSSocket from "embedded:io/socket/tcp/tls";
import TCP from "embedded:io/socket/tcp";
import TextDecoder from "text/decoder";
import TextEncoder from "text/encoder";

export class NATS {
	constructor(
		address,
		port = NATS.DEFAULT_HTTPS_PORT,
		user = null,
		pass = null,
		isSecure = true,
		caCert = null,
	) {
		this.address = address;
		this.port = port;
		this.user = user;
		this.pass = pass;
		this.subs = new Map();
		this.outstandingPings = 0;
		this.connected = false;
		this.isSecure = isSecure;
		this.onConnect = null;
		this.onDisconnect = null;
		this.onError = null;
		this.encoder = new TextEncoder();
		this.decoder = new TextDecoder();

		if (isSecure) {
			this.client = new TLSSocket({
				address: this.address,
				port: this.port,
				secure: {
					ca: caCert, // CA証明書をここに渡す
					protocolVersion: 0x303, // TLS 1.2
				},
				onWritable: () => this.onWriable(),
				onReadable: () => this.recv(),
				onError: () => this.handleError(),
				onClose: () => this.handleDisconnect(),
			});
		} else {
			this.client = new TCP({
				address: this.address,
				port: this.port,
				onReadable: () => this.recv(),
				onError: () => this.handleError(),
				onClose: () => this.handleDisconnect(),
			});
		}
	}

	onWriable() {
		trace("wriable\n")
		if (!this.connected) {
			this.sendConnect();
		}
	}

	send(msg) {
		this.client.write(this.encoder.encode(`${msg}\r\n`));
	}

	sendConnect() {
		const connectMsg = JSON.stringify({
			verbose: false,
			pedantic: false,
			lang: NATS.CLIENT_LANG,
			version: NATS.CLIENT_VERSION,
			user: this.user,
			pass: this.pass,
		});
		this.send(`CONNECT ${connectMsg}`);
	}

	recv() {
		trace("recv\n");
		// const message = this.client.read()?.toString();
		const buffer = this.client.read();
		const message = this.decoder.decode(buffer)
		if (message) {
			this.handleMessage(message);
		}
	}

	handleMessage(message) {
		trace(`handleMessage: ${message}`);
		const lines = message.split("\r\n");
		for (const line of lines) {
			if (line.startsWith(NATS.CTRL_MSG)) {
				this.handleMsg(line);
			} else if (line.startsWith(NATS.CTRL_PING)) {
				this.send(NATS.CTRL_PONG);
			} else if (line.startsWith(NATS.CTRL_PONG)) {
				this.outstandingPings--;
			} else if (line.startsWith(NATS.CTRL_INFO)) {
				this.sendConnect();
				this.connected = true;
				this.onConnect?.();
			} else if (line.startsWith(NATS.CTRL_ERR)) {
				this.onError?.();
				this.disconnect();
			}
		}
	}

	handleMsg(line) {
		const parts = line.split(" ");
		const sid = Number.parseInt(parts[2], 10);
		const callback = this.subs.get(sid);
		if (callback) {
			const payload = parts.slice(4).join(" ");
			callback({
				subject: parts[1],
				sid,
				data: payload,
				size: payload.length,
			});
		}
	}

	handleError() {
		this.onError?.();
		this.disconnect();
	}

	handleDisconnect() {
		this.connected = false;
		this.onDisconnect?.();
		this.subs.clear();
	}

	connect() {
		if (!this.connected) {
			this.client.connect(this.port, this.address);
		}
	}

	disconnect() {
		if (this.connected) {
			this.connected = false;
			this.client.close();
		}
	}

	publish(subject, msg) {
		if (!this.connected) return;
		this.send(`PUB ${subject} ${msg.length}\r\n${msg}`);
	}

	subscribe(subject, callback) {
		const sid = this.subs.size;
		this.subs.set(sid, callback);
		if (this.connected) {
			this.send(`SUB ${subject} ${sid}`);
		}
		return sid;
	}

	unsubscribe(sid) {
		if (!this.connected) return;
		this.send(`UNSUB ${sid}`);
		this.subs.delete(sid);
	}
}

NATS.CLIENT_LANG = "javascript";
NATS.CLIENT_VERSION = "1.0.0";
NATS.PING_INTERVAL = 120000; // 120 seconds
NATS.RECONNECT_INTERVAL = 5000; // 5 seconds
NATS.DEFAULT_HTTP_PORT = 4222;
NATS.DEFAULT_HTTPS_PORT = 443;
NATS.CTRL_MSG = "MSG";
NATS.CTRL_PING = "PING";
NATS.CTRL_PONG = "PONG";
NATS.CTRL_INFO = "INFO";
NATS.CTRL_OK = "+OK";
NATS.CTRL_ERR = "-ERR";
