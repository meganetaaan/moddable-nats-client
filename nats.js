import TLSSocket from "embedded:io/socket/tcp/tls";
import TCP from "embedded:io/socket/tcp";
import TextDecoder from "text/decoder";
import TextEncoder from "text/encoder";

export class NATS {
	#pendingWrite = null;
	#writePosition = 0;
	#bufferSize = 1024;
	#writable = false;
	#writableCount = 0;
	constructor({
		address,
		port = NATS.DEFAULT_HTTP_PORT,
		useTLS = false,
		caCert = null,
		user = null,
		pass = null,
		onConnect,
		onDisconnect,
		onError,
	}) {
		this.address = address;
		this.port = port;
		this.user = user;
		this.pass = pass;
		this.subs = new Map();
		this.outstandingPings = 0;
		this.connected = false;
		this.useTLS = useTLS;

		this.onConnect = onConnect;
		this.onDisconnect = onDisconnect;
		this.onError = onError;
		this.encoder = new TextEncoder();
		this.decoder = new TextDecoder();

		// 初期バッファサイズを設定
		this.#bufferSize = 1024; // 1KBの初期バッファを確保
		this.#pendingWrite = new Uint8Array(this.#bufferSize);
		this.#writePosition = 0;

		if (useTLS) {
			this.client = new TLSSocket({
				address: this.address,
				port: this.port,
				secure: {
					ca: caCert, // CA証明書をここに渡す
					protocolVersion: 0x303, // TLS 1.2
				},
				onWritable: (count) => this.#onWritable(count),
				onReadable: () => this.recv(),
				onError: () => this.handleError(),
				onClose: () => this.handleDisconnect(),
			});
		} else {
			this.client = new TCP({
				address: this.address,
				port: this.port,
				onWritable: (count) => this.#onWritable(count),
				onReadable: () => this.recv(),
				onError: () => this.handleError(),
				onClose: () => this.handleDisconnect(),
			});
		}
	}

	send(msg) {
		// trace(`sending: ${msg}\n`);
		const buffer = this.encoder.encode(`${msg}\r\n`);
		const remainingSpace = this.#bufferSize - this.#writePosition;

		if (buffer.byteLength > remainingSpace) {
			this.#expandBuffer(buffer.byteLength - remainingSpace);
		}

		this.#pendingWrite.set(buffer, this.#writePosition);
		this.#writePosition += buffer.byteLength;

		if (this.#writable) {
			this.#onWritable();
		}
	}

	#expandBuffer(additionalLength) {
		const newSize = this.#bufferSize + additionalLength;
		const newBuffer = new Uint8Array(newSize);

		newBuffer.set(this.#pendingWrite.subarray(0, this.#writePosition), 0);

		this.#pendingWrite = newBuffer;
		this.#bufferSize = newSize;
	}

	#onWritable(count = this.#writableCount) {
		const toWrite = Math.min(this.#writePosition, count);
		// trace(`writable: ${count}, toWrite: ${toWrite}\n`);

		if (toWrite > 0) {
			this.client.write(this.#pendingWrite.subarray(0, toWrite));

			this.#pendingWrite.copyWithin(0, toWrite, this.#writePosition);
			this.#writePosition -= toWrite;
			this.#writable = false;
		} else {
			this.#writable = true;
			this.#writableCount = count;
		}
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
		// trace("recv\n");
		const buffer = this.client.read();
		const message = this.decoder.decode(buffer);
		if (message) {
			this.handleMessage(message);
		}
	}

	handleMessage(message) {
		// trace(`handleMessage: ${message}`);
		const lines = message.split("\r\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line.startsWith(NATS.CTRL_MSG)) {
				i += 1;
				this.handleMsg(line, lines[i]);
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

	handleMsg(line, msg) {
		const parts = line.split(" ");
		const sid = Number.parseInt(parts[2], 10);
		const callback = this.subs.get(sid);
		if (callback) {
			const payload = parts.slice(4).join(" ") + msg;
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
		const msgStr = JSON.stringify(msg);
		if (!this.connected) return;
		this.send(`PUB ${subject} ${msgStr.length}\r\n${msgStr}`);
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
