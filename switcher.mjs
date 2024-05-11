const bonjour = require('bonjour')();
const { Atem } = require('atem-connection');
const atem = null;

export function detectSwitcherAddress() {
    // Start browsing for Blackmagic services
    bonjour.find({ type: '_blackmagic._tcp' }, function (service) {
        console.log('Found a Blackmagic device:');
        console.log(`Name: ${service.name}`);
        console.log(`IP Address: ${service.referer.address}`);
        console.log(`Port: ${service.port}`);
    });

    // Optional: stop browsing after a certain period
    setTimeout(() => {
        bonjour.destroy();
        console.log('Stopped browsing');
    }, 30000);

    return service.referer.address;
}

export function connectToAtemSwitcher(ip) {
    atem = new Atem();
    atem.on('info', console.log);
    atem.on('error', console.error);
    (async () => {
        await atem.connect(ip);
    })();
}

export function changeInput(num) {
    if (!atem) {
        return;
    }
    atem.changeProgramInput(num).then(() => {
        console.log('Program input changed to 1');
    }).catch(console.error);
}