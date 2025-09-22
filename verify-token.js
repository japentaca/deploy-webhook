import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

async function verifyGitHubToken() {
    const token = process.env.GITHUB_ACCESS_TOKEN;
    
    if (!token) {
        console.error('Error: GITHUB_ACCESS_TOKEN no está configurado en .env');
        return;
    }

    const headers = {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Deploy-Webhook-Verifier'
    };

    try {
        console.log('Verificando acceso del token de GitHub...\n');

        // 1. Verificar información del usuario/token
        console.log('1. Verificando información del token:');
        const userResponse = await fetch('https://api.github.com/user', { headers });
        
        if (!userResponse.ok) {
            throw new Error(`Error de autenticación: ${userResponse.status} ${userResponse.statusText}`);
        }
        
        const userInfo = await userResponse.json();
        console.log(`   Token válido para usuario: ${userInfo.login}`);
        console.log(`   Email: ${userInfo.email || 'No público'}`);
        console.log(`   Permisos del token: ${userResponse.headers.get('x-oauth-scopes') || 'No disponible'}\n`);

        // 2. Verificar acceso a la organización
        console.log('2. Verificando acceso a la organización mieldesanpedro:');
        const orgResponse = await fetch('https://api.github.com/orgs/mieldesanpedro', { headers });
        
        if (orgResponse.ok) {
            const orgInfo = await orgResponse.json();
            console.log(`   Acceso a organización: ${orgInfo.name || orgInfo.login}`);
        } else {
            console.log(`   Sin acceso a la organización (${orgResponse.status})`);
        }

        // 3. Listar repositorios de la organización
        console.log('\n3. Listando repositorios de la organización:');
        const reposResponse = await fetch('https://api.github.com/orgs/mieldesanpedro/repos?per_page=10', { headers });
        
        if (reposResponse.ok) {
            const repos = await reposResponse.json();
            console.log(`   Repositorios encontrados: ${repos.length}`);
            
            repos.forEach((repo, index) => {
                console.log(`   ${index + 1}. ${repo.name} (${repo.private ? 'Privado' : 'Público'})`);
                console.log(`      URL: ${repo.html_url}`);
            });

            // 4. Verificar acceso a GitHub Actions en el primer repositorio
            if (repos.length > 0) {
                const firstRepo = repos[0];
                console.log(`\n4. Verificando acceso a GitHub Actions en ${firstRepo.name}:`);
                
                const actionsResponse = await fetch(`https://api.github.com/repos/${firstRepo.full_name}/actions/runs?per_page=5`, { headers });
                
                if (actionsResponse.ok) {
                    const actionsData = await actionsResponse.json();
                    console.log(`   Acceso a GitHub Actions exitoso`);
                    console.log(`   Total de workflow runs: ${actionsData.total_count}`);
                    
                    // Verificar acceso a artefactos
                    const artifactsResponse = await fetch(`https://api.github.com/repos/${firstRepo.full_name}/actions/artifacts?per_page=5`, { headers });
                    
                    if (artifactsResponse.ok) {
                        const artifactsData = await artifactsResponse.json();
                        console.log(`   Acceso a artefactos exitoso`);
                        console.log(`   Total de artefactos: ${artifactsData.total_count}`);
                        
                        if (artifactsData.artifacts.length > 0) {
                            console.log(`   Artefactos recientes:`);
                            artifactsData.artifacts.slice(0, 3).forEach((artifact, index) => {
                                console.log(`      ${index + 1}. ${artifact.name} (ID: ${artifact.id})`);
                            });
                        }
                    } else {
                        console.log(`   Sin acceso a artefactos (${artifactsResponse.status})`);
                    }
                } else {
                    console.log(`   Sin acceso a GitHub Actions (${actionsResponse.status})`);
                }
            }

            // 5. Verificar específicamente el repositorio monorepo
            console.log(`\n5. Verificando repositorio específico 'monorepo':`);
            const monorepoResponse = await fetch('https://api.github.com/repos/mieldesanpedro/monorepo', { headers });
            
            if (monorepoResponse.ok) {
                const monorepoInfo = await monorepoResponse.json();
                console.log(`   Repositorio 'monorepo' encontrado`);
                console.log(`   Privado: ${monorepoInfo.private ? 'Sí' : 'No'}`);
                console.log(`   Última actualización: ${new Date(monorepoInfo.updated_at).toLocaleDateString()}`);
            } else {
                console.log(`   Repositorio 'monorepo' no encontrado o sin acceso (${monorepoResponse.status})`);
                if (monorepoResponse.status === 404) {
                    console.log(`   El repositorio puede no existir o ser privado sin acceso`);
                }
            }

        } else {
            console.log(`   Sin acceso a repositorios de la organización (${reposResponse.status})`);
        }

    } catch (error) {
        console.error('Error durante la verificación:', error.message);
    }
}

// Ejecutar verificación
verifyGitHubToken();