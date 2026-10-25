// Tools return ordinary objects. Only this layer knows the MCP result envelope.
function result(data, limit) {
	const text = JSON.stringify(data);
	if (Buffer.byteLength(text) > limit) {
		throw new Error('Result exceeds the MCP output limit. Request fewer rows or selected fields. The operation may already have completed.');
	}
	return { structuredContent: data, content: [{ type: 'text', text }] };
}

function failure(error, redact) {
	return { isError: true, content: [{ type: 'text', text: redact(error.message || error) }] };
}

module.exports = { result, failure };
