'use strict';
const { pathToFileURL } = require('node:url');

// Exact serialized URL identity for the single inert document. No directory grant.
module.exports = function fixtureContent(filename) {
  const expected = pathToFileURL(filename).href;
  return url => url === expected || url === 'about:blank';
};
