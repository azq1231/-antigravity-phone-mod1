
import http from 'http';

http.get('http://localhost:3004/slots', (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        console.log('Slots:', JSON.stringify(JSON.parse(data), null, 2));
    });
}).on('error', (err) => {
    console.error('Error:', err.message);
});
