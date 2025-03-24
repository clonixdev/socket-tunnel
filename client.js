const net = require('net');
const ss = require('socket.io-stream');
const { Transform } = require('stream');
const io = require('socket.io-client');

const IDLE_SOCKET_TIMEOUT_MILLISECONDS = 1000 * 30;

class BufferAccumulator extends Transform {
  constructor(options = {}) {
    super(options);
    this.accumulator = Buffer.alloc(512 * 1024);
    this.accumulatedSize = 0;
    this.flushInterval = options.flushInterval || 150;
    this.timer = null;
    this.resetTimer();
  }

  resetTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.flushInterval);
  }

  flush() {
    if (this.accumulatedSize > 0) {
      this.push(this.accumulator.subarray(0, this.accumulatedSize));
      this.accumulator = Buffer.alloc(512 * 1024);
      this.accumulatedSize = 0;
    }
    this.resetTimer();
  }

  _transform(chunk, encoding, callback) {
    this.resetTimer();
    while (chunk.length > 0) {
      const remainingSpace = this.accumulator.length - this.accumulatedSize;
      const bytesToCopy = Math.min(remainingSpace, chunk.length);
      chunk.copy(this.accumulator, this.accumulatedSize, 0, bytesToCopy);
      this.accumulatedSize += bytesToCopy;
      if (this.accumulatedSize === this.accumulator.length) {
        this.push(this.accumulator);
        this.accumulator = Buffer.alloc(512 * 1024);
        this.accumulatedSize = 0;
      }
      chunk = chunk.slice(bytesToCopy);
    }
    callback();
  }

  _flush(callback) {
    clearTimeout(this.timer);
    this.flush();
    callback();
  }
}

module.exports = (options) => {

  console.log("Client start ",options);

  console.log("Intentando conectar con el servidor:", options.server);
  
  const socket =  io(options.server, {
     reconnection: true, // Activa la reconexión automática
     reconnectionAttempts: 10, // Intentos máximos de reconexión
     reconnectionDelay: 5000, // Tiempo entre intentos de reconexión (5 segundos)
     timeout: 20000, // Tiempo máximo de espera para conectar inicialmente (20 segundos)
    transports: ['websocket'] // Usa WebSocket en lugar de polling
  });

  socket.on('connect', () => {
    console.log(`${new Date()}: connected`);
    console.log(`${new Date()}: requesting subdomain ${options.subdomain} via ${options.server}`);
    socket.emit('createTunnel', options.subdomain);
   /* socket.emit('createTunnel', options.subdomain, (err) => {
      if (err) {
        console.log(new Date() + ': [error] ' + err);

        reject(err);
      } else {
        console.log(new Date() + ': registered with server successfully');

        // clean and concat requested url
        let url;
        let subdomain = options.subdomain.toString();
        let server = options.server.toString();

        if (subdomain.startsWith('*.')) {
          console.log(new Date() + `: Wildcard habilitado para subdominios de ${subdomain.slice(2)}`);
          subdomain = `*.${subdomain.slice(2)}`; // Mantener consistencia en la representación
        }

        if (server.includes('https://')) {
          url = `https://${subdomain}.${server.slice(8)}`;
        } else if (server.includes('http://')) {
          url = `http://${subdomain}.${server.slice(7)}`;
        } else {
          url = `https://${subdomain}.${server}`;
        }

        // resolve promise with requested URL
        resolve(url);
      }
    });*/
  });

  socket.on('connect_error', (err) => {
    console.log(`${new Date()}: connection error: `,err);
  });

  socket.on('error', (err) => {
    console.error(new Date() + ': [error]', err);
    /*if (err.message.includes('xhr poll error')) {
      console.log(new Date() + ': Forzando reconexión debido a xhr poll error');
      socket.connect(); // Intentar reconectar manualmente
    }*/
  });


  socket.on('disconnect', (reason) => {
    console.log(new Date() + ': Desconectado del servidor: ', reason);
    /* if (reason === 'io server disconnect') {
       // El servidor desconectó explícitamente, intentar reconectar
       console.log(new Date() + ': Intentando reconectar...');
       socket.connect();
     }*/
  });

  socket.on('reconnect', (attemptNumber) => {
    console.log(new Date() + `: Reconectado exitosamente en el intento ${attemptNumber}`);
  });


  socket.on('reconnect_failed', () => {
    console.error(new Date() + ': [error] Falló la reconexión después de varios intentos');
    //reject(new Error('No se pudo reconectar al servidor'));
  });

  socket.on('incomingClient', (clientId) => {
    console.log(`incomingClient: ${clientId}`);
    const client = net.connect({
      port: options.port,
      host: options.hostname,
    }, () => {
      console.log(`${clientId} connected to ${options.hostname}:${options.port}`);
      const s = ss.createStream({ highWaterMark: 512 * 1024 });

      // let size = 0;
      // client.on('data', (data) => {
      //     size += data.length;
      //     console.log(`${clientId} received ${size/1024} KB`);
      // });

      const acc = new BufferAccumulator();
      // net.connect send data with 64KB buffer, we need to increase it using BufferAccumulator to speed up the transfer
      client.pipe(acc).pipe(s);
      s.pipe(client);

      s.on('end', () => {
        client.destroy();
      });

      ss(socket).emit(clientId, s);
    });

    client.setTimeout(IDLE_SOCKET_TIMEOUT_MILLISECONDS);
    client.on('timeout', () => {
      console.log(new Date() + ': Cliente timeout');
      client.end();
    });

    client.on('error', () => {
      console.log(new Date() + ': Cliente error 1');
      const s = ss.createStream();
      ss(socket).emit(clientId, s);
      s.end();
    });
  });

};
