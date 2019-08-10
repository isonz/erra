import io from 'socket.io-client';

import { SocketListener } from '../lib/interface';

const socket = io('http://localhost:63236');

socket.emit('test', 111)

socket.on('api-response', (url, data) => {
  console.log('====== api-response', url, data);
})

function on(eventName: string, cb: SocketListener) {
  socket.on(eventName, cb)
}

function emit (eventName: string, ...args) {
  socket.emit(eventName, ...args)
}

export default {
  emit,
  on,
}