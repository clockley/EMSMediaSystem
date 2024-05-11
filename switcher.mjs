const bonjour = require('bonjour')();

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