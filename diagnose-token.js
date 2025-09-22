import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

function diagnoseToken() {
    const token = process.env.GITHUB_ACCESS_TOKEN;
    
    console.log('Diagnóstico del token de GitHub:\n');
    
    if (!token) {
        console.error('❌ GITHUB_ACCESS_TOKEN no está configurado en .env');
        return;
    }
    
    console.log('✅ Token encontrado en variables de entorno');
    console.log(`📏 Longitud del token: ${token.length} caracteres`);
    
    // Verificar formato del token
    if (token.startsWith('github_pat_')) {
        console.log('✅ Formato de token válido (Fine-grained personal access token)');
        console.log(`🔍 Prefijo: ${token.substring(0, 15)}...`);
    } else if (token.startsWith('ghp_')) {
        console.log('✅ Formato de token válido (Classic personal access token)');
        console.log(`🔍 Prefijo: ${token.substring(0, 8)}...`);
    } else if (token.startsWith('gho_')) {
        console.log('✅ Formato de token válido (OAuth token)');
        console.log(`🔍 Prefijo: ${token.substring(0, 8)}...`);
    } else if (token.startsWith('ghu_')) {
        console.log('✅ Formato de token válido (User-to-server token)');
        console.log(`🔍 Prefijo: ${token.substring(0, 8)}...`);
    } else if (token.startsWith('ghs_')) {
        console.log('✅ Formato de token válido (Server-to-server token)');
        console.log(`🔍 Prefijo: ${token.substring(0, 8)}...`);
    } else {
        console.log('⚠️  Formato de token no reconocido');
        console.log(`🔍 Prefijo: ${token.substring(0, 10)}...`);
    }
    
    // Verificar caracteres válidos
    const validChars = /^[a-zA-Z0-9_]+$/;
    if (validChars.test(token)) {
        console.log('✅ Caracteres del token válidos');
    } else {
        console.log('❌ El token contiene caracteres inválidos');
    }
    
    // Mostrar información adicional
    console.log('\n📋 Información adicional:');
    console.log('- Los tokens de GitHub deben tener entre 40-255 caracteres');
    console.log('- Los Fine-grained tokens empiezan con "github_pat_"');
    console.log('- Los Classic tokens empiezan con "ghp_"');
    console.log('- Verifica que el token no haya expirado en GitHub');
    console.log('- Asegúrate de que el token tenga los permisos necesarios:');
    console.log('  • repo (acceso completo a repositorios)');
    console.log('  • actions:read (leer GitHub Actions)');
    console.log('  • metadata:read (leer metadatos)');
    
    console.log('\n🔗 Para verificar/regenerar el token:');
    console.log('1. Ve a https://github.com/settings/tokens');
    console.log('2. Encuentra tu token o crea uno nuevo');
    console.log('3. Asegúrate de que tenga los permisos correctos');
    console.log('4. Si es un Fine-grained token, verifica que tenga acceso a la organización');
}

// Ejecutar diagnóstico
diagnoseToken();