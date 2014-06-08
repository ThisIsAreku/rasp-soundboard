const
	fs = require('fs'),
	path = require('path'),
	process = require('child_process'),
	qs = require('querystring'),
	merge = require('merge');

var api = new Api;
const
	soundFolder = __dirname + '/sounds/',
	localFolder = __dirname + '/public/'

var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);

var soundFiles = null;

app.get('/', function(req, res){
	res.sendfile(localFolder + 'index.html');
});

var playersCount = 0;
var players = {};
io.on('connection', function (socket) {
	var clientIP = socket.request.connection.remoteAddress;
	console.log("Connexion from " + clientIP);
	players[socket.id] = clientIP;
	playersCount++;
	if(soundFiles != null)
		socket.emit('getFiles', soundFiles);
	socket.on('playSound', function (data, fn){
		var soundName = soundFiles[data.hash]
		socket.broadcast.emit('startSound', { name: soundName, hash: data.hash });
		fn({ name: soundName, hash: data.hash })
		api.playSound(data.hash, function (soundName){
			io.emit('endSound', { name: soundName, hash: data.hash });
		});
	});
	socket.on('stopAll', function (data, fn){
		console.log("-- STOP ALL -- ");
		api.stopAll();
	});
	socket.on('Refresh', function (data){
		console.log('Re-Indexing..');
		walk(soundFolder, function(err, results) {
			if (err) throw err;
			soundFiles = results;
			io.emit('getFiles', soundFiles);
		});
	});
	socket.on('PlayingStats', function (data, fn){
		fn(api.listCurrentSounds());
	});
	io.emit('PlayerStats', { count: playersCount, data: players });
	socket.on('disconnect', function () {
		console.log("Disconnect from " + clientIP);
		playersCount--;
		delete players[socket.id];
		io.emit('PlayerStats', { count: playersCount, data: players });
	});
});

var walk = function(dir, done) {
  var results = {};
  fs.readdir(dir, function(err, list) {
    if (err) return done(err);
    var pending = list.length;
    if (!pending) return done(null, results);
    list.forEach(function(file) {
      file = dir + '/' + file;
      fs.stat(file, function(err, stat) {
        if (stat && stat.isDirectory()) {
          walk(file, function(err, res) {
          	results = merge(results, res);
            if (!--pending) done(null, results);
          });
        } else {
      	  var extension = getExtension(file);
      	  if(extension == 'mp3' || extension == 'wav' || extension == 'ogg') {
	          var fname = file.substring(soundFolder.length+1);
	          var digest = require('crypto').createHash('md5').update(fname).digest('hex');
	          results[digest] = fname;
	      }
          if (!--pending) done(null, results);
        }
      });
    });
  });
};


console.log('Indexing..');
walk(soundFolder, function(err, results) {
	if (err) throw err;
	soundFiles = results;
	io.emit('getFiles', soundFiles);
});


http.listen(7123, function(){
  console.log('listening on *:7123');
});


function Api(){
	var allProcess = {};
	var allSounds = {};
	this.playSound = function (soundNameHash, callback) {
		var soundName = soundFiles[soundNameHash];
		var p = startChildProcess(soundName);
		allProcess[p.pid] = p;
		allSounds[p.pid] = soundName;
		p.on('exit', function (){
			delete allProcess[this.pid];
			delete allSounds[this.pid];
			callback(soundName);
		})
	}
	this.stopAll = function () {
		for(var pid in allProcess){
			allProcess[pid].kill();
		}
	}
	this.listCurrentSounds = function () {
		return allSounds;
	}
}

function startChildProcess(soundName) {
	var pname = 'aplay';
	var ext = getExtension(soundName);
	if(ext == "mp3")
		pname = 'mpg123';
	if(ext == "ogg")
		pname = 'ogg123';
	return process.spawn(pname, [soundFolder + soundName]);
}
function getExtension(filename) {
    var ext = path.extname(filename||'').split('.');
    return ext[ext.length - 1].toLowerCase();
}