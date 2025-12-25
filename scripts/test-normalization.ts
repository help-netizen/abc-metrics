import { NormalizationService } from '../src/services/normalization.service';

function testNormalization() {
    console.log('🧪 Testing phone number normalization...');

    const testCases = [
        { input: '1234567890', expected: '1234567890' },
        { input: '(123) 456-7890', expected: '1234567890' },
        { input: '+11234567890', expected: '1234567890' },
        { input: '1-123-456-7890', expected: '1234567890' },
        { input: '123.456.7890', expected: '1234567890' },
        { input: '+71234567890', expected: '71234567890' }, // Non-US, but starts with 1 handling: 11 digits starting with 1 -> strip 1. This is 11 digits starting with 7, so it keeps 7.
        { input: '112345678900', expected: '112345678900' }, // 12 digits, keep all
    ];

    for (const { input, expected } of testCases) {
        const result = NormalizationService.phone(input);
        if (result === expected) {
            console.log(`✅ PASS: "${input}" -> "${result}"`);
        } else {
            console.error(`❌ FAIL: "${input}" expected "${expected}", got "${result}"`);
        }
    }

    console.log('\n🧪 Testing object normalization...');

    const testObject = {
        name: 'John Doe',
        Phone: '(123) 456-7890',
        nested: {
            'Caller ID': '+1 987 654 3210',
            other: 'not a phone'
        },
        list: [
            { 'From number': '1-555-000-1111' },
            { type: 'home', phone: '222-333-4444' }
        ]
    };

    const normalized = NormalizationService.normalizeObjectPhoneFields(testObject);

    const results = [
        normalized.Phone === '1234567890',
        normalized.nested['Caller ID'] === '9876543210',
        normalized.list[0]['From number'] === '5550001111',
        normalized.list[1].phone === '2223334444'
    ];

    if (results.every(r => r)) {
        console.log('✅ PASS: Object fields correctly normalized');
        console.log(JSON.stringify(normalized, null, 2));
    } else {
        console.error('❌ FAIL: Some object fields were not correctly normalized');
        console.log(JSON.stringify(normalized, null, 2));
    }
}

testNormalization();
