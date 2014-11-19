var document = require('jsdom').jsdom('<!doctype html><html><head></head><body></body></html>'),
    window = document.createWindow(),
    globals = {};

// Requiring D3 requires all this ceremony because it expects document and
// window to be global

// stash globals
if ("window" in global) globals.window = global.window;
global.window = window;
if ("document" in global) globals.document = global.document;
global.document = document;
if ("d3" in global) globals.d3 = global.d3;

// https://github.com/chad3814/CSSStyleDeclaration/issues/3
var CSSStyleDeclaration_prototype = window.CSSStyleDeclaration.prototype,
    CSSStyleDeclaration_setProperty = CSSStyleDeclaration_prototype.setProperty;
CSSStyleDeclaration_prototype.setProperty = function(name, value, priority) {
  return CSSStyleDeclaration_setProperty.call(this, name + "", value == null ? null : value + "", priority == null ? null : priority + "");
};

var d3 = global.d3 = require('d3/d3');
var SimpleTimeseries = require('./simple-timeseries');

// restore globals
if ("window" in globals) global.window = globals.window;
else delete global.window;
if ("document" in globals) global.document = globals.document;
else delete global.document;
if ("d3" in globals) global.d3 = globals.d3;
else delete global.d3;

module.exports = function(data, options) {
  var simpleTimeSeries = new SimpleTimeseries(data, options);
  document.body.appendChild(simpleTimeSeries.el);

  var svg =
    '<?xml version="1.0" standalone="no"?>\n' +
     '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
    '<?xml-stylesheet href="' + options.stylesheetURL + '" type="text/css"?>\n' +
    document.querySelector('.st-container').innerHTML;

  document.body.innerHTML = '';

  return svg;
}
