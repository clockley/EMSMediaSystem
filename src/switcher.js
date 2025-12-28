/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

const bonjour = require("bonjour")();
const { Atem } = require("atem-connection");
let atem = null;

function detectSwitcherAddress() {
  bonjour.find({ type: "_blackmagic._tcp" }, function (service) {
    console.log("Found a Blackmagic device:");
    console.log(`Name: ${service.name}`);
    console.log(`IP Address: ${service.referer.address}`);
    console.log(`Port: ${service.port}`);
  });

  setTimeout(() => {
    bonjour.destroy();
    console.log("Stopped browsing");
  }, 30000);
}

async function connectToAtemSwitcher(ip) {
  atem = new Atem();
  atem.on("info", console.log);
  atem.on("error", console.error);
  await atem.connect(ip);
}

function changeInput(num) {
  if (!atem) {
    return;
  }
  atem
    .changeProgramInput(num)
    .then(() => {
      console.log("Program input changed to", num);
    })
    .catch(console.error);
}

module.exports = {
  detectSwitcherAddress,
  connectToAtemSwitcher,
  changeInput,
};
