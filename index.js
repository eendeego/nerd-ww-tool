var fs = require('fs');
var zlib = require('zlib');
var spawn = require('child_process').spawn;

var request = require('request');
var parseArgs = require('minimist');
var chart = require('./lib/chart');
var d3 = require('d3');

var TARGET_WEIGHT = 84.5;
// var TARGET_DATE = new Date('2014-05-26 11:40:00');
var TARGET_DATE = new Date('2014-07-14 12:40:00');
var START_DATE = new Date('2014-03-10 11:00:00');
var DAY = 24 * 60 * 60 * 1000;

process.on('uncaughtException', function (err) {
  console.log('Caught exception: ' + err);
});

var argv = parseArgs(process.argv.slice(2), {
  string: ['batik', 'config', '_'],
  boolean: ['imageMagick', 'f'],
  alias: { c: 'config', b: 'batik', i: 'imageMagick' }
});

var config = JSON.parse(fs.readFileSync(argv.config));

config.rasterize = argv.batik ? batikRasterize :
  argv.imageMagick ? imRasterize : writeSVG;
config.forceUpdate = argv.f;

readLastUpdate();

function readLastUpdate() {
  fs.readFile('out/last-update.txt', function (err, lastUpdate) {
    lastUpdate = new Date(lastUpdate).getTime();
    var lastUpdateDay = Math.floor(lastUpdate / DAY);
    var today = Math.floor(Date.now() / DAY);

    if (today > lastUpdateDay || config.forceUpdate) {
      fetchData(processData);
    }
  });
}

function fetchData(fn) {
  var data = '';
  var dataRequest = request({
    url: 'http://www.trueweight.net/download/?' +
          config.trueweight.secret.split('-').
            map(function (s, i) { return 'pc' + (i + 1) + '=' + s; }).
            join('&'),
    headers: {
     'Accept-Encoding': 'gzip,deflate,sdch',
     'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/33.0.1750.152 Safari/537.36'
    }
  }).pipe(zlib.createGunzip());
  dataRequest.on('data', function (d) { data += d});
  dataRequest.on('end', function () {
    fs.writeFile('out/data.csv', ('date,weigth\n' + data).replace(/,/g, ';'));
    fn(d3.csv.parse('date,weigth\n' + data));
  });
}

function leastSquares(data) {
  // http://mathworld.wolfram.com/LeastSquaresFitting.html
  data = data.map(function (d) { return [d[0] / DAY, d[1] * 1000]; });
  var n = data.length;
  var avgx = data.reduce(function (s, d) { return s + d[0]; }, 0) / n;
  var avgy = data.reduce(function (s, d) { return s + d[1]; }, 0) / n;
  var ssxx = data.reduce(function (s, d) { return s + d[0] * d[0]; }, 0) - n * avgx * avgx;
  var ssyy = data.reduce(function (s, d) { return s + d[1] * d[1]; }, 0) - n * avgy * avgy;
  var ssxy = data.reduce(function (s, d) { return s + d[0] * d[1]; }, 0) - n * avgx * avgy;
  var b = ssxy / ssxx;
  var a = avgy - b * avgx;
  var rSquared = ssxy * ssxy / (ssxx * ssyy);
  return {
    a : a,
    b : b,
    rSquared : rSquared,
    σxSquared : ssxx / n,
    σySquared : ssyy / n,
    covxy : ssxy / n
  };
}

function movingAverage(data, sampleSize) {
  var i, t = 0, result = new Array(data.length - sampleSize);
  for(i = 0; i < sampleSize; i++) { t += data[i][1]; }
  for(; i < data.length; i++) {
    result.push([data[i][0], t / sampleSize]);
    t = t - data[i - sampleSize][1] + data[i][1];
  }
  return result;
}

function processData(data) {
  // data = data.sort(function (a,b) {
  //   return a.date - b.date;
  // });
  data.reverse();

  var chartOptions = {
    width: config.chart.width,
    height: config.chart.height,
    stylesheetURL: config.chart.stylesheetURL,
    margin: config.chart.margin
  };

  var taskCount = 0;
  function done() {
    if (--taskCount == 0) {
      // process.stdout.write('Done!\n');
    }
  }

  function addTask(fn) {
    taskCount++;
    process.nextTick(fn);
  }

  var mainChart = [{
    name: 'full',
    label: '',
    data: data.map(function (o) {
      return [ new Date(o.date).getTime(), o.weigth / 1000 ];
    })
  }];
  mainChart[0].label = mainChart[0].data[mainChart[0].data.length - 1][1].toString();

  var start = START_DATE.getTime();
  var detail = [{
    name: 'detail',
    label: mainChart[0].label,
    data: mainChart[0].data.filter(function (sample) {
      return sample[0] >= start;
    })
  }, {
    label: TARGET_WEIGHT,
    data: [[TARGET_DATE.getTime(), TARGET_WEIGHT]]
  }];

  var n = detail[0].data.length;
  var ls = leastSquares(detail[0].data);

  var stop = Math.max(TARGET_DATE.getTime(), detail[0].data[n - 1][0]);
  var currentTrend = (stop / DAY * ls.b + ls.a) / 1000;
  detail.push({
    name: 'linear-regression ' + (currentTrend > TARGET_WEIGHT ? 'bad' : 'good'),
    label: currentTrend,
    data: [[ detail[0].data[0][0], (detail[0].data[0][0] / DAY * ls.b + ls.a) / 1000],
           [ stop, currentTrend]],
    linearRegression: ls
  });

  var ma = movingAverage(mainChart[0].data, 7).
    filter(function (sample) {
      return sample[0] >= start;
    });
  detail.push({
    name: 'moving-average ' + (ma[ma.length-1][1] < detail[0].data[detail[0].data.length - 1][1] ? 'bad' : 'good'),
    label: '',
    data: ma,
    linearRegression: ls
  })

  addTask(function () {
    generateChart(mainChart, chartOptions, function (svg) {
      config.rasterize(svg, {
        svgFile : 'out/big-picture.svg',
        pngFile : 'out/big-picture.png'
      }, done);
    });
  });

  addTask(function () {
    generateChart(detail, chartOptions, function (svg) {
      config.rasterize(svg, {
        svgFile : 'out/last-month.svg',
        pngFile : 'out/last-month.png'
      }, done);
    });
  });

  addTask(function () {
    var currentWeight = data[data.length - 1].weigth / 1000;
    var eta = (Date.now() - TARGET_DATE.getTime()) / DAY;
    var sgn = eta > 0 ? '+' : '-';
    if (Math.abs(eta) > 1) { eta = Math.floor(Math.abs(eta)); }
    var txt = currentWeight + ' ➤ ' + TARGET_WEIGHT + ' T' + sgn + eta;

    fs.writeFile('out/target.txt', txt, function (err) {
      if (err) throw err;
      done();
    });
  });

  addTask(function () {
    var lastDate = data[data.length - 1].date;

    fs.writeFile('out/last-update.txt', lastDate, function (err) {
      if (err) throw err;
      done();
    });
  });
}

function generateChart(data, opts, fn) {
  fn(chart(data, opts));
}

function imRasterize(svg, options, fn) {
  var out = fs.createWriteStream(options.pngFile);
  var convert = spawn("convert", ["svg:", "png:-"]);

  convert.stdout.pipe(out);
  convert.on('exit', function (code) {
    out.close();
    fn();
  });
  convert.stdin.write(svg);
  convert.stdin.end();
}

function batikRasterize(svg, options, fn) {
  fs.writeFile(options.svgFile, svg, function (err) {
    if (err) throw err;
    var batik = spawn('/usr/bin/java', ['-Djava.awt.headless=true', '-jar', argv.batik, '-d', options.pngFile, options.svgFile]);
    batik.on('exit', function () { fn(); });
  });
}

function writeSVG(svg, options, fn) {
  fs.writeFile(options.svgFile, svg, function (err) {
    if (err) throw err;
    fn();
  });
}
