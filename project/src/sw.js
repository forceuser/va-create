/* global clients */

// const baseUrl = self.scriptURL.replace(/\/[^\/]*?$/igm, "/");
const baseUrl = location.origin.replace(/\/$/, "") + "/";

function escapeRegExp (s) {
	return s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

class Deferred {
	constructor () {
		this.promise = new Promise((resolve, reject) => {
			this.ctrl = {resolve, reject};
		});
	}
	resolve () {
		return this.ctrl.resolve();
	}
	reject () {
		return this.ctrl.reject();
	}
}

const cacheName = "static";

self.addEventListener("install", event => {
	console.log("sw install", event);
});

self.addEventListener("activate", event => {
	console.log("sw activate", event);

});

self.addEventListener("message", event => {
	console.log("sw message", event);
});

function isAbsoluteURL (string) {
	return /^([a-z]+:\/\/|\/\/)/i.test(string);
}

self.addEventListener("fetch", event => {
	console.log("sw fetch", event.request.url);
	event.respondWith((async () => {
		const request = event.request;
		const url = request.url;
		const relUrl = (url.replace(new RegExp("^" + escapeRegExp(baseUrl), "igm"), "") || "").split("#")[0].split("?")[0];
		const isAbsolute = isAbsoluteURL(relUrl) && !relUrl.includes("recaptcha");
		const isCacheable = isAbsolute || (["css/", "img/", "js/"].some(match => relUrl.startsWith(match)) && !relUrl.match(/^(api|browsersymc)\//));
		// console.log("relUrl", url, relUrl, isCacheable, isIndexHtml);
		if (isCacheable) {
			const cache = await caches.open(cacheName);
			try {
				const response = await fetch(request);
				if (response.ok) {
					cache.put(request, response.clone());
				}
				return response;
			}
			catch (error) {
				//
			}
			const cachedResponse = await cache.match(request);
			if (cachedResponse) {
				return cachedResponse;
			}
		}
		else {
			return fetch(request).catch(error => {
				console.log("SW fetch error", error);
				const body = new Blob([JSON.stringify({online: false})], {type: "application/json"});
				return new Response(body, {
					status: 400,
					statusText: "network_error",
				});
			});
		}

	})());
});
