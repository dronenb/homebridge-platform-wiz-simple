'use strict';
var udp = require('dgram');
var ping = require('ping');
var os = require('os');
var color_convert = require('color-convert');
// var temp_convert = require('mired');
var Accessory, Characteristic, Service, UUIDGen;

module.exports = function (homebridge) {
	Accessory = homebridge.platformAccessory;
	Characteristic = homebridge.hap.Characteristic;
	Service = homebridge.hap.Service;
	UUIDGen = homebridge.hap.uuid;

	homebridge.registerPlatform("homebridge-platform-wiz-simple", "wiz-simple", WizSimple, true);
}

function WizSimple (log, config, api){
	if (!config){
		log.warn("Ignoring Wiz Platform setup because it is not configured");
		this.disabled = true;
		return;
	}
	this.config = config;
	if (this.config.devices && this.config.devices.constructor !== Array) {
		delete this.config.devices
	}
	var platform = this;
	this.log = log;
	this.config = config;
	this.accessories = {};
	this.accessory_ips = {};

	if (api){
		this.api = api;
		this.api.on('didFinishLaunching', function(){
			for (var device_index in this.config.devices){
				var device = this.config.devices[device_index];
				this.addAccessory(device.name, device.ip, device.features);
			}
			for (var accessory_uuid in this.accessories){
				var accessory = this.accessories[accessory_uuid];
				ping.sys.probe(accessory._ip, function(isAlive){
					// Add code to update reachability, then put this in a setIntervalImmediately call...
				});
			}
			if (Number.isInteger(this.config.homeId)){
				this._server = udp.createSocket('udp4');
				this._server.on('message', function (msg, rinfo) {
					if (this.accessory_ips[rinfo.address]){
						var wizAccessory = this.accessories[UUIDGen.generate(rinfo.address)];
						var accessory = wizAccessory.accessory;
						if (!accessory){
							return;
						}
						var response = JSON.parse(msg);
						console.log(response);
						if (typeof response.params.state === "boolean" && wizAccessory._state !== response.params.state){
							wizAccessory._state = response.params.state;
							this.log("Updating accessory state on accessory " + accessory.displayName + " to " + response.params.state);
							accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On).updateValue(response.params.state);
						}
						if (typeof response.params.dimming === "number" && wizAccessory._dimming !== response.params.dimming){
							wizAccessory._dimming = response.params.dimming;
							this.log("Updating accessory dimming on accessory " + accessory.displayName + " to " + response.params.dimming);
							accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Brightness).updateValue(response.params.dimming);
						}
						if (
								Number.isInteger(response.params.r)
								&&
								Number.isInteger(response.params.g)
								&&
								Number.isInteger(response.params.b)
						){
							var conversion = color_convert.rgb.hsv(response.params.r, response.params.g, response.params.b);
							if (wizAccessory._hue !== conversion[0] || wizAccessory._saturation !== conversion[1]){
								wizAccessory._hue = Math.round(conversion[0]);
								wizAccessory._saturation = Math.round(conversion[1]);
								this.log("Updating hue/saturation on accessory " + accessory.displayName + " to " + wizAccessory._hue + "/" + wizAccessory._saturation);
								accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Hue).updateValue(wizAccessory._hue);
								accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Saturation).updateValue(wizAccessory._saturation);
							}
						}
					}
				}.bind(this));
				// this._server.on('listening', function() {
				// 	this.log(this._server.address());
				// }.bind(this));
				this._server.bind(38900);
				var interfaces = os.networkInterfaces();
				this._local_ip_addresses = [];
				// Attempt to get current IP address
				for (var interface_name in interfaces){
					var network_interface = interfaces[interface_name];
					for (var info_index in network_interface){
						var info_obj = network_interface[info_index];
						if (info_obj.family && info_obj.family === 'IPv4'){
							if (info_obj.address && info_obj.address !== '127.0.0.1' && info_obj.mac && info_obj.mac !== '00:00:00:00:00:00'){
								this.log("Will add '" + info_obj.address + " to devices to recieve light status packets.")
								this._local_ip_addresses.push({"address":info_obj.address, "mac":info_obj.mac});
							}
						}
					}
				}
				setIntervalImmediately(function(){
					console.log("Function running");
					for (var accessory_uuid in this.accessories){
						for (var ip_index in this._local_ip_addresses){
							var local_if = this._local_ip_addresses[ip_index];
							this.accessories[accessory_uuid]._send(JSON.stringify(
								{
									"params"	:	{
										"homeId"	:	this.config.homeId,
										"phoneIp"	:	local_if.address,
										"phoneMac"	:	local_if.mac.replace(/:/g, ''),
										"register"	:	true
									},
									"method"	:	"registration"
								}
							));
						}
					}
				}.bind(this), 35000);

			}
		}.bind(this));
	}
}

WizSimple.prototype.configureAccessory = function(accessory) {
	this.log("Configuring cached accessory" + accessory.displayName);
	this.accessories[accessory.UUID] = new WizAccessory(this.log, accessory);
	this.accessory_ips[accessory.context.ip] = 1;
}

WizSimple.prototype.addAccessory = function(deviceName, ip, features){
	this.log("Adding accessory with IP: '" + ip + "' and name '" + deviceName + "'");
	var platform = this;
	var uuid = UUIDGen.generate(ip);
	if (this.accessories[uuid]){
		this.log("...but acessory is already configured. Skipping...");
		return;
	}
	var newAccessory = new Accessory(deviceName, uuid);
	this.accessory_ips[ip] = 1;
	newAccessory.context.ip = ip;
	newAccessory.context.features = features;
	var lightbulb_service = newAccessory.addService(Service.Lightbulb, deviceName);
	if (newAccessory.context.features.dimmable){
		lightbulb_service.addCharacteristic(Characteristic.Brightness);
	}
	if (newAccessory.context.features.color){
		lightbulb_service.addCharacteristic(Characteristic.Hue);
		lightbulb_service.addCharacteristic(Characteristic.Saturation);
	}
	// if (newAccessory.context.features.temperature){
		// lightbulb_service.addCharacteristic(Characteristic.ColorTemperature)
		// lightbulb_service.getCharacteristic(Characteristic.ColorTemperature).setProps({
			// minValue: Math.ceil(temp_convert.kelvinToMired(2200)), // K and Mired are reversed
			// maxValue: Math.floor(temp_convert.kelvinToMired(6500)), // K and Mired are reversed
		// });
	// }
	this.accessories[uuid] = new WizAccessory(this.log, newAccessory);
	this.api.registerPlatformAccessories("homebridge-platform-wiz-simple", "wiz-simple", [newAccessory]);
	var accessory_info = newAccessory.getService(Service.AccessoryInformation)
	accessory_info.setCharacteristic(Characteristic.Manufacturer, "WiZ");
	accessory_info.setCharacteristic(Characteristic.Model, "Unknown");
	accessory_info.setCharacteristic(Characteristic.SerialNumber, "Unknown");
	accessory_info.setCharacteristic(Characteristic.FirmwareRevision, "Unknown");

}

function WizAccessory (log, accessory){
	var self = this;
	this.accessory = accessory;
	this.log = log;
	this._ip = accessory.context.ip;
	this._client = udp.createSocket('udp4');
	this._dimming = 100;
	this._state = true;
	this._hue = 0;
	this._saturation = 	100;
	// this._temp = 2700;
	var lightbulb_service = accessory.getService(Service.Lightbulb);
	lightbulb_service.getCharacteristic(Characteristic.On).on('set', this.setState.bind(this));
	if (lightbulb_service.getCharacteristic(Characteristic.Brightness)){
		lightbulb_service.getCharacteristic(Characteristic.Brightness).on('set', this.setDimming.bind(this));
	}
	if (lightbulb_service.getCharacteristic(Characteristic.Hue)){
		lightbulb_service.getCharacteristic(Characteristic.Hue).on('set', this.setHue.bind(this));
	}
	if (lightbulb_service.getCharacteristic(Characteristic.Saturation)){
		lightbulb_service.getCharacteristic(Characteristic.Saturation).on('set', this.setSaturation.bind(this));
	}
	// if (lightbulb_service.getCharacteristic(Characteristic.ColorTemperature)){
	// 	lightbulb_service.getCharacteristic(Characteristic.ColorTemperature).on('set', this.setTemp.bind(this));
	// }
}
WizAccessory.prototype._send = async function(msg){
	if (!this._client){
		this._client = udp.createSocket('udp4');
	}
	await this._client.send(msg, 38899, this._ip);
	this._client.close();
	this._client = udp.createSocket('udp4');
}

WizAccessory.prototype.setDimming = function (value, callback){
	this.log("Setting dimming on " + this.accessory.displayName + " to " + value + "%");
	callback = callback || function() {};
	this._dimming = parseInt(value);
	var params = {
		method	:	"setPilot",
		params	:	{
			"dimming"	:	parseInt(value)
		}
	};
	this._send(JSON.stringify(params));
	callback(null);
}
WizAccessory.prototype.setState = function (value, callback){
	this.log("Setting state on " + this.accessory.displayName + " to " + value);
	callback = callback || function() {};
	var params = {
		method	:	"setPilot",
		params	:	{
			"state"	:	value
		}
	};
	this._send(JSON.stringify(params));
	callback(null);
}
WizAccessory.prototype.setHue = function (value, callback){
	this.log("Setting hue on " + this.accessory.displayName + " to " + value);
	callback = callback || function() {};
	this._hue = value;
	var result = color_convert.hsv.rgb(parseInt(this._hue), parseInt(this._saturation), parseInt(this._dimming));
	var params = {
		method	:	"setPilot",
		params	:	{
			"r"	:	result[0],
			"g"	:	result[1],
			"b"	:	result[2]
		}
	};
	// this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.ColorTemperature).updateValue(0);
	this._send(JSON.stringify(params));
	callback(null);
}
WizAccessory.prototype.setSaturation = function (value, callback){
	this.log("Setting saturation on " + this.accessory.displayName + " to " + value);
	callback = callback || function() {};
	this._saturation = value;
	var result = color_convert.hsv.rgb(parseInt(this._hue), parseInt(this._saturation), parseInt(this._dimming));
	var params = {
		method	:	"setPilot",
		params	:	{
			"r"	:	result[0],
			"g"	:	result[1],
			"b"	:	result[2]
		}
	};
	this._send(JSON.stringify(params));
	// this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.ColorTemperature).updateValue(0);
	callback(null);
}

function setIntervalImmediately(func, interval) {
  func();
  return setInterval(func, interval);
}
// WizAccessory.prototype.setTemp = function (value, callback){
// 	this._temp = Math.round(temp_convert.miredToKelvin(value));
// 	this.log("Setting color temperature on " + this.accessory.displayName + " to " + this._temp);
// 	callback = callback || function() {};
// 	var params = {
// 		method	:	"setPilot",
// 		params	:	{
// 			"temp"	:	this._temp
// 		}
// 	};
// 	this._send(JSON.stringify(params));
// 	this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Hue).updateValue(0);
// 	this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Saturation).updateValue(0);
// 	this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.ColorTemperature).updateValue(value);
// 	callback(null);
// }
