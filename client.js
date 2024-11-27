'use strict';

const IDLE_SOCKET_TIMEOUT_MILLISECONDS = 1000 * 30;

module.exports = (options) => {
  return new Promise((resolve, reject) => {
    // require the things we need
    const net = require('net');
    const ss = require('socket.io-stream');
    let socket = require('socket.io-client')(options['server'], {
      reconnection: true, // Activa la reconexión automática
      reconnectionAttempts: 10, // Intentos máximos de reconexión
      reconnectionDelay: 5000, // Tiempo entre intentos de reconexión (5 segundos)
      timeout: 20000, // Tiempo máximo de espera para conectar inicialmente (20 segundos)
     // transports: ['websocket'] // Usa WebSocket en lugar de polling
    });

	console.log(new Date() + ': clonix socket');
		
    socket.on('connect', () => {
      console.log(new Date() + ': connected');
      console.log(new Date() + ': requesting subdomain ' + options['subdomain'] + ' via ' + options['server']);

      socket.emit('createTunnel', options['subdomain'], (err) => {
        if (err) {
          console.log(new Date() + ': [error] ' + err);

          reject(err);
        } else {
          console.log(new Date() + ': registered with server successfully');

          // clean and concat requested url
          let url;
          let subdomain = options['subdomain'].toString();
          let server = options['server'].toString();

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
      });
    });

	// Manejo de conexiones entrantes
    socket.on('incomingClient', (clientId) => {
      let client = net.connect(options['port'], options['hostname'], () => {
        let s = ss.createStream();
        s.pipe(client).pipe(s);

        s.on('end', () => {
		  console.log(new Date() + ': Cliente desconectado');
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
        // handle connection refusal (create a stream and immediately close it)
		
		console.log(new Date() + ': Cliente error 1');
				
        let s = ss.createStream();
        ss(socket).emit(clientId, s);
        s.end();
      });
    });
	
	
	socket.on('error', (err) => {
      console.error(new Date() + ': [error]', err);
      if (err.message.includes('xhr poll error')) {
        console.log(new Date() + ': Forzando reconexión debido a xhr poll error');
        socket.connect(); // Intentar reconectar manualmente
      }
	});

	socket.on('disconnect', (reason) => {
      console.log(new Date() + ': Desconectado del servidor: ', reason);
      if (reason === 'io server disconnect') {
        // El servidor desconectó explícitamente, intentar reconectar
        console.log(new Date() + ': Intentando reconectar...');
        socket.connect();
      }
	});
	
	// Evento para reconexión exitosa
    socket.on('reconnect', (attemptNumber) => {
      console.log(new Date() + `: Reconectado exitosamente en el intento ${attemptNumber}`);
    });

	
	socket.on('reconnect_failed', () => {
      console.error(new Date() + ': [error] Falló la reconexión después de varios intentos');
      reject(new Error('No se pudo reconectar al servidor'));
    });

  });
};
