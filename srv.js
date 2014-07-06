const
	fs = require('fs'),
	path = require('path'),
	process = require('child_process'),
	qs = require('querystring'),
	merge = require('merge'),
	InputEvent = require('../keybd/input-event');

const VERSION = "1.2";

const api = new Api;
const keyboard = new InputEvent('event0');

const
	soundFolder = __dirname + '/sounds/',
	localFolder = __dirname + '/public/'

var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);

var soundFiles = null;
var keybindings = {};

app.get('/', function(req, res){
	res.sendfile(localFolder + 'index.html');
});
app.get('/keyboard.js', function(req, res){
	res.sendfile(localFolder + 'keyboard.js');
});
app.get('/getSounds.json', function(req, res){
	res.sendfile(localFolder+'soundCache.json');
});
app.get('/getBindings.json', function(req, res){
	res.sendfile(localFolder+'bindingsCache.json');
});
app.get('/getSound/:id(^[a-z]{0,10}$)', function(req, res){
	res.end(JSON.stringify(req.params));
});

var playersCount = 0;
var players = {};
io.on('connection', function (socket) {
	var clientIP = socket.request.connection.remoteAddress;
	console.log("Connexion from " + clientIP);
	players[socket.id] = clientIP;
	playersCount++;
	/*if(soundFiles != null)
		socket.emit('getFiles', soundFiles);*/
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
		reIndexSoundFiles();
	});
	socket.on('add bind', function (data){
		var keyName = data.key.toUpperCase();
		console.log('Binding ' + keyName + ' to ' + soundFiles[data.hash]);
		keybindings['KEY_'+keyName] = data.hash;
		fs.writeFile(localFolder+'bindingsCache.json', JSON.stringify(keybindings));	
	});
	socket.on('remove bind', function (data){
		var keyName = data.key.toUpperCase();
		console.log('Removing binding ' + keyName);
		delete keybindings['KEY_'+keyName];
		fs.writeFile(localFolder+'bindingsCache.json', JSON.stringify(keybindings));
	});
	socket.on('PlayingStats', function (data, fn){
		fn(api.listCurrentSounds());
	});
	io.emit('PlayerStats', { count: playersCount, data: players, version: VERSION });
	socket.on('disconnect', function () {
		console.log("Disconnect from " + clientIP);
		playersCount--;
		delete players[socket.id];
		io.emit('PlayerStats', { count: playersCount, data: players, version: VERSION });
	});
	socket.on('reconnect', function () {
		if(soundFiles != null)
			socket.emit('getFiles', soundFiles);
	});
});

keyboard.on('keypress', function (event){
	if(event.keyCode == 57){
		console.log("[KBD] -- STOP ALL -- ");
		return api.stopAll();
	}
	io.emit('key pressed', event);
	if('undefined' == typeof keybindings[event.keyName])
		return;

	var hash = keybindings[event.keyName];
	var soundName = soundFiles[hash]
	console.log("[KBD] startSound: "+soundName);
	io.emit('startSound', { name: soundName, hash: hash });
	api.playSound(hash, function (soundName){
		io.emit('endSound', { name: soundName, hash: hash });
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

if(fs.existsSync(localFolder+'soundCache.json')){
	console.log('Reading sounds from cache..');
	var filestr = fs.readFileSync(localFolder+'soundCache.json');
	soundFiles = JSON.parse(filestr);
	console.log('Checking cache..');
	checkCache();
}else{
	console.log('Indexing..');
	reIndexSoundFiles();
}

if(fs.existsSync(localFolder+'bindingsCache.json')){
	console.log('Reading bindings from cache..');
	var filestr = fs.readFileSync(localFolder+'bindingsCache.json');
	keybindings = JSON.parse(filestr);
}

function reIndexSoundFiles(){
	walk(soundFolder, function(err, results) {
		if (err) throw err;
		soundFiles = results;
		console.log(Object.keys(soundFiles).length + " file(s) indexed");
		io.emit('getFiles', soundFiles);
		fs.writeFile(localFolder+'soundCache.json', JSON.stringify(soundFiles));
	});
}

function checkCache(){
	var missing = 0;
	var remains = Object.keys(soundFiles).length;
	for(var hash in soundFiles){
		var file = soundFiles[hash];
		fs.exists(soundFolder+file, function(ex){
			if(!ex){
				if(missing == 0)
					reIndexSoundFiles();
				missing++;
				console.log(file + " is missing");
			}
			if(!--remains){
				console.log("Cache checked");
				console.log(Object.keys(soundFiles).length + " file(s) indexed");
			}
		})
	}
}



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