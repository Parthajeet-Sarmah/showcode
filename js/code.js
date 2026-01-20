import { getSettingsHeaders } from "./settings.js"
import { API_BASE_URL } from "./config.js";

const proxyUrl = `${API_BASE_URL}/analyze`;

export async function callCodeAnalysisApi(codeSnippet, outputEle, firstTokenGeneratedErrands = () => { }, context = null, signature = null) {

	var score = 0;
	let isFirstTokenGenerated = false;

	outputEle.innerHTML = '';

	const data = {
		code: codeSnippet,
		context: context
	};

	const settingsHeaders = getSettingsHeaders()

	const headers = {
		'Content-Type': 'application/json',
		'X-Use-Snippet-Model': false,
		...settingsHeaders,
	};

	if (signature) {
		headers['X-Snippet-Signature'] = signature;
	}

	try {
		const response = await fetch(proxyUrl, {
			method: 'POST',
			headers: headers,
			body: JSON.stringify(data),
		});

		if (!response.ok) {
			const errorText = await response.text();
			if (window.showToast) window.showToast(`Error in API, Check your configurations in Settings: ${errorText}`, "error");
			throw new Error(`HTTP error! Status: ${response.status}. Details: ${errorText}`);
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder('utf-8');
		let fullResponse = '';

		async function readStream() {
			const { done, value } = await reader.read();

			const outputElement = outputEle;

			if (done) {
				console.log("Stream finished. Parsing Markdown now...");

				try {
					const htmlContent = marked.parse(fullResponse, { renderer: window.markedRenderer });
					outputElement.innerHTML = htmlContent;
					outputElement.querySelectorAll('pre code').forEach((block) => {
						hljs.highlightElement(block);
					});
					const m = htmlContent.match(/(\d+)\/\d+/);

					if (m) {
						score = parseInt(m[1]);
					}

				} catch (e) {
					console.error("Markdown parsing failed:", e);
					outputElement.textContent = fullResponse;
				}

				return;
			}

			const chunk = decoder.decode(value, { stream: true });
			if (!isFirstTokenGenerated) {
				isFirstTokenGenerated = true;
				firstTokenGeneratedErrands();
			}

			fullResponse += chunk;
			outputElement.textContent += chunk;

			await readStream();
		}

		await readStream();
		return score;

	} catch (error) {
		console.error('API Call Error:', error);
		return -1;
	}
}

export async function callSnippetAnalysisApi(codeSnippet, outputEle, firstTokenGeneratedErrands = () => { }, context = null) {

	var score = 0;
	let isFirstTokenGenerated = false;

	const settingsHeaders = getSettingsHeaders()

	const data = {
		code: codeSnippet,
		context: context
	};

	try {
		const response = await fetch(proxyUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Use-Snippet-Model': true,
				...settingsHeaders,
			},
			body: JSON.stringify(data),
		});

		if (!response.ok) {
			const errorText = await response.text();
			if (window.showToast) window.showToast(`Error in API, Check your configurations in Settings: ${errorText}`, "error");
			throw new Error(`HTTP error! Status: ${response.status}. Details: ${errorText}`);
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder('utf-8');
		let fullResponse = '';

		async function readStream() {
			const { done, value } = await reader.read();

			const outputElement = outputEle;

			if (done) {
				console.log("Stream finished. Parsing Markdown now...");

				try {
					const htmlContent = marked.parse(fullResponse, { renderer: window.markedRenderer });
					outputElement.innerHTML = htmlContent;
					outputElement.querySelectorAll('pre code').forEach((block) => {
						hljs.highlightElement(block);
					});
					const m = htmlContent.match(/(\d+)\/\d+/);

					if (m) {
						score = parseInt(m[1]);
					}

				} catch (e) {
					console.error("Markdown parsing failed:", e);
					outputElement.textContent = fullResponse;
				}

				return;
			}

			const chunk = decoder.decode(value, { stream: true });
			if (!isFirstTokenGenerated) {
				isFirstTokenGenerated = true;
				firstTokenGeneratedErrands();
			}

			fullResponse += chunk;
			outputElement.textContent += chunk;

			await readStream();
		}

		await readStream();
		return score;

	} catch (error) {
		throw error;
	}
}
