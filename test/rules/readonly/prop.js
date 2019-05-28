export let p = Math.random();

export let jsObj = {};
Object.defineProperty(jsObj, 'a', {value: 1, writable: false});
Object.defineProperty(jsObj, 'b', {get() { return 1; }});
Object.defineProperty(jsObj, 'c', {get() { return 1; }, set(_) {}});
Object.defineProperty(jsObj, 'd', {value: 1});
Object.defineProperty(jsObj, 'e', {value: 1, writable: true});
const descriptor = {value: 1, writable: false};
Object.defineProperty(jsObj, 'f', descriptor);
