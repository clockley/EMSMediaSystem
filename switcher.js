const bonjour = require('bonjour')();
const { Atem } = require('atem-connection');
let atem = null;

function detectSwitcherAddress() {
    bonjour.find({ type: '_blackmagic._tcp' }, function (service) {
        console.log('Found a Blackmagic device:');
        console.log(`Name: ${service.name}`);
        console.log(`IP Address: ${service.referer.address}`);
        console.log(`Port: ${service.port}`);
    });

    setTimeout(() => {
        bonjour.destroy();
        console.log('Stopped browsing');
    }, 30000);
}

async function connectToAtemSwitcher(ip) {
    atem = new Atem();
    atem.on('info', console.log);
    atem.on('error', console.error);
    await atem.connect(ip);
}

function changeInput(num) {
    if (!atem) {
        return;
    }
    atem.changeProgramInput(num).then(() => {
        console.log('Program input changed to', num);
    }).catch(console.error);
}

module.exports = {
    detectSwitcherAddress,
    connectToAtemSwitcher,
    changeInput
};
