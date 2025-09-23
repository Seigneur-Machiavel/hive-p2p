
function compare(iteration = 50_000) {
	console.log(`\nComparing performance of Object vs Map with ${iteration} elements:`);
	
	// ASSIGNMENT / CREATION
	let start = performance.now();
	const obj = {};
	for (let i = 0; i < iteration; i++) obj[i.toString()] = { index: i, data: 'some data' + i };
	let objTime = performance.now() - start;
	
	start = performance.now();
	const map = new Map();
	for (let i = 0; i < iteration; i++) map.set(i.toString(), { index: i, data: 'some data' + i });
	console.log(`ASSIGNMENT / CREATION: Obj: ${objTime.toFixed(2)} ms, Map: ${(performance.now() - start).toFixed(2)} ms`);

	// ITERATION
	start = performance.now();
	for (const key in obj) obj[key].index++;
	objTime = performance.now() - start;

	start = performance.now();
	for (const [key, value] of map) value.index++;
	console.log(`ITERATION: Obj: ${objTime.toFixed(2)} ms, Map: ${(performance.now() - start).toFixed(2)} ms`);
	
	// KEY ACCESS
	start = performance.now();
	for (let i = 0; i < iteration; i++) obj[i.toString()].index++;
	objTime = performance.now() - start;
	
	start = performance.now();
	for (let i = 0; i < iteration; i++) map.get(i.toString()).index++;
	console.log(`KEY ACCESS: Obj: ${objTime.toFixed(2)} ms, Map: ${(performance.now() - start).toFixed(2)} ms`);

	// LENGTH RETRIEVAL
	start = performance.now();
	const objectLen = Object.keys(obj).length;
	objTime = performance.now() - start;

	start = performance.now();
	const mapLen = map.size;
	console.log(`LENGTH RETRIEVAL: Obj: ${objTime.toFixed(2)} ms, Map: ${(performance.now() - start).toFixed(2)} ms`);

	// SERIALIZATION ARRAY
	start = performance.now();
	let str = JSON.stringify(Object.entries(obj));
	let parsed = JSON.parse(str);
	objTime = performance.now() - start;

	start = performance.now();
	str = JSON.stringify([...map]);
	parsed = new Map(JSON.parse(str));
	console.log(`SERIALIZATION ARRAY: Obj: ${objTime.toFixed(2)} ms, Map: ${(performance.now() - start).toFixed(2)} ms`);

	// SERIALIZATION OBJECT
	start = performance.now();
	str = JSON.stringify(obj);
	parsed = JSON.parse(str);
	objTime = performance.now() - start;

	start = performance.now();
	str = JSON.stringify(Object.fromEntries(map));
	parsed = new Map(Object.entries(JSON.parse(str)));
	console.log(`SERIALIZATION OBJECT: Obj: ${objTime.toFixed(2)} ms, Map: ${(performance.now() - start).toFixed(2)} ms`);
}

for (const iteration of [10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000]) compare(iteration);

