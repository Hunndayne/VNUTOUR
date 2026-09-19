"""Run real Bash/jq/htpasswd with fake SSH/Kubernetes/HTTP; never contact a VPS."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

UI = Path(__file__).resolve().parents[1]
FAKE = r'''#!/usr/bin/env python3
import io, json, os, pathlib, sys, tarfile
tool = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
root = pathlib.Path(os.environ['TEST_ROOT'])
case = os.environ.get('TEST_CASE', '')
with (root/'calls.jsonl').open('a') as out:
    out.write(json.dumps([tool, args])+'\n')
if args in (['--version'], ['-V']):
    versions = {'curl': 'curl 7.81.0', 'ssh': 'OpenSSH_9.6p1',
                'sshpass': 'sshpass 1.09', 'k3s': 'k3s version v1.36.3+k3s1'}
    if tool == 'curl' and case == 'old-curl':
        print('curl 7.40.0')
    else:
        print(versions[tool])
    sys.exit(0)
if tool == 'apt-get':
    if 'install' in args:
        if case == 'install-fail': sys.exit(1)
        (root/'tools-installed').touch()
    sys.exit(0)
if tool == 'id':
    print('0'); sys.exit(0)
if tool == 'sshpass':
    assert args[0] == '-f', 'SSH password must be read from a private file'
    assert 'VPS_SSH_PASSWORD' not in os.environ
    assert 'SSHPASS' not in os.environ
    password_file = pathlib.Path(args[1])
    assert password_file.stat().st_mode & 0o077 == 0
    assert password_file.read_text() == os.environ['TEST_SSH_PASSWORD']+'\n'
    if case == 'bad-ssh-password': sys.exit(5)
    os.execvp(args[2], args[2:])
if tool == 'ssh':
    import subprocess
    assert subprocess.run(['bash', '-n'], input=args[-1], text=True).returncode == 0
    if case == 'ssh-fail': sys.exit(1)
    with tarfile.open(fileobj=io.BytesIO(sys.stdin.buffer.read()), mode='r:gz') as archive:
        for item in archive:
            if item.isfile():
                (root/'received'/pathlib.Path(item.name).name).write_bytes(archive.extractfile(item).read())
    sys.exit(0)
if tool == 'curl':
    url = next((a for a in args if a.startswith(('http://', 'https://'))), '')
    output = pathlib.Path(args[args.index('-o')+1]) if '-o' in args else None
    if 'releases/download/' in url:
        output.write_text('fake-cert-manager'); sys.exit(0)
    if case == 'tls-fail': sys.exit(60)
    if url.startswith('http://'):
        pathlib.Path(args[args.index('-D')+1]).write_text('Location: https://cd.example.com/\r\n')
        print('308', end=''); sys.exit(0)
    if url.endswith('/api/v1/session'):
        body = json.loads(pathlib.Path(args[args.index('--data-binary')+1][1:]).read_text())
        assert body == {'username': 'admin', 'password': os.environ['TEST_PASSWORD']}
        if case == 'bad-login': sys.exit(22)
        output.write_text(json.dumps({'token': 'test-only-token'})); sys.exit(0)
    if url.endswith('/api/v1/applications') and '-H' not in args:
        print('200' if case == 'anonymous-open' else '401', end='')
    sys.exit(0)
if tool == 'k3s':
    if 'version' in args:
        version = 'v1.31.0+k3s1' if case == 'unsupported-kubernetes' else 'v1.36.3+k3s1'
        print(json.dumps({'clientVersion': {'gitVersion': version}, 'serverVersion': {'gitVersion': version}}))
    elif 'get' in args and 'deployment' in args and 'cert-manager' in args:
        version = 'v1.11.0' if case == 'old-cert-manager' else 'v1.21.2'
        print(json.dumps({'spec': {'template': {'spec': {'containers': [{'image': 'test/controller:'+version}]}}}}))
    elif 'get' in args and 'deployments' in args and case == 'cert-manager-without-crds':
        print('deployment.apps/cert-manager')
    elif 'get' in args and 'deployments' in args:
        if case not in ('no-cert-manager', 'unsupported-kubernetes'):
            print('deployment.apps/cert-manager\ndeployment.apps/cert-manager-cainjector\ndeployment.apps/cert-manager-webhook')
    elif 'get' in args and 'ingressclass' in args:
        print(json.dumps({'spec': {'controller': 'k8s.io/ingress-nginx'}}))
    elif 'get' in args and 'service' in args:
        print(json.dumps({'spec': {'type': 'ClusterIP', 'ports': [{'port': 443}]}}))
    elif 'get' in args and 'deployment' in args:
        print(json.dumps({'spec': {'template': {'spec': {'containers': [
            {'args': ['--insecure']} if case == 'insecure' else {'args': []}
        ]}}}}))
    elif 'get' in args and 'crd' in args:
        if case == 'api-fail': sys.exit(1)
        if case == 'partial-cert-manager':
            if '--ignore-not-found' not in args: sys.exit(1)
            print('crd/certificates.cert-manager.io')
        elif case not in ('no-cert-manager', 'unsupported-kubernetes', 'cert-manager-without-crds'):
            print('crd/certificaterequests.cert-manager.io\ncrd/certificates.cert-manager.io\ncrd/challenges.acme.cert-manager.io\ncrd/clusterissuers.cert-manager.io\ncrd/issuers.cert-manager.io\ncrd/orders.acme.cert-manager.io')
    elif 'patch' in args:
        name = args[args.index('patch')+2]
        patch = json.loads(pathlib.Path(args[args.index('--patch-file')+1]).read_text())
        (root/(name+'.patch.json')).write_text(json.dumps(patch))
    elif 'wait' in args and 'certificate/argocd-ui-tls' in args and case == 'certificate-fail':
        sys.exit(1)
    elif 'wait' in args and 'clusterissuer/letsencrypt-prod' in args and case == 'issuer-fail':
        sys.exit(1)
    sys.exit(0)
raise SystemExit('Unexpected mock tool')
'''


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        for tool in ('bash', 'jq', 'htpasswd'):
            if not shutil.which(tool):
                self.skipTest('Linux test dependency missing: ' + tool)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'bin').mkdir()
        (self.root/'received').mkdir()
        (self.root/'runner').mkdir()
        for tool in ('sshpass', 'ssh', 'curl', 'k3s', 'id', 'apt-get'):
            path = self.root/'bin'/tool
            path.write_text(FAKE)
            path.chmod(0o700)
        self.password = 'test-only-"$`-password-123'
        self.ssh_password = 'ssh-test-"$`\\ password'
        self.env = {**os.environ, 'PATH': str(self.root/'bin')+os.pathsep+os.environ['PATH'],
                    'GITHUB_ACTIONS': 'false', 'RUNNER_TEMP': str(self.root/'runner'),
                    'TEST_ROOT': str(self.root), 'TEST_PASSWORD': self.password,
                    'TEST_SSH_PASSWORD': self.ssh_password,
                    'ARGOCD_HOSTNAME': 'cd.example.com', 'ACME_EMAIL': 'test@example.com',
                    'ARGOCD_ADMIN_PASSWORD': self.password, 'VPS_SSH_HOST': '192.0.2.1',
                    'VPS_SSH_USER': 'root', 'VPS_SSH_PASSWORD': self.ssh_password,
                    'VPS_SSH_KNOWN_HOSTS': 'test-only-host-key', 'VPS_SSH_PORT': '22'}

    def calls(self):
        path = self.root/'calls.jsonl'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def http_calls(self):
        return [args for tool, args in self.calls()
                if tool == 'curl' and any(a.startswith(('http://', 'https://')) for a in args)]

    def deploy(self, **env):
        result = subprocess.run(['bash', str(UI/'deploy.sh')], env={**self.env, **env},
                                capture_output=True, text=True)
        self.assertNotIn(self.password, result.stdout + result.stderr)
        self.assertNotIn(self.ssh_password, result.stdout + result.stderr)
        self.assertEqual(list((self.root/'runner').iterdir()), [], 'Temporary credentials were not cleaned')
        return result

    def bootstrap(self, case='', missing_tools=''):
        payload = self.root/'payload'
        payload.mkdir()
        for name in ('certificate', 'ingress'):
            shutil.copy(UI/(name+'.yaml'), payload/(name+'.yaml'))
        shutil.copy(UI.parents[1]/'cert-manager-issuer.yaml', payload/'cluster-issuers.yaml')
        for name, body in {
            'password': {'stringData': {'admin.password': 'test-hash', 'admin.passwordMtime': 'test-time'}},
            'cm': {'data': {'url': 'https://cd.example.com', 'users.anonymous.enabled': 'false', 'admin.enabled': 'true'}},
            'params': {'data': {'server.insecure': 'false', 'server.basehref': '/', 'server.rootpath': ''}},
        }.items():
            (payload/(name+'.json')).write_text(json.dumps(body))
        kubeconfig = self.root/'kubeconfig'
        kubeconfig.touch()
        script = self.root/'bootstrap.sh'
        # Substitute only the fixed file location to avoid touching /etc during tests.
        script.write_text((UI/'bootstrap.sh').read_text().replace('/etc/rancher/k3s/k3s.yaml', str(kubeconfig)))
        # Simulate absent commands without uninstalling anything from the test machine.
        command = '''
# Simulate command -v without changing production script control flow.
command() {
  if [[ $1 == -v && ",${TEST_MISSING_TOOLS}," == *",$2,"* && ! -f "$TEST_ROOT/tools-installed" ]]; then
    return 1
  fi
  builtin command "$@"
}
script=$1
shift
source "$script"
'''
        return subprocess.run(['bash', '-c', command, 'test', str(script), str(payload)],
                              env={**self.env, 'TEST_CASE': case, 'TEST_MISSING_TOOLS': missing_tools},
                              capture_output=True, text=True)

    def test_render_transport_and_login(self):
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        files = {p.name: p.read_text() for p in (self.root/'received').iterdir()}
        self.assertNotIn(self.password, ''.join(files.values()))
        self.assertNotIn(self.ssh_password, ''.join(files.values()))
        self.assertNotIn('login.json', files)
        self.assertNotIn('argocd.example.invalid', files['ingress.yaml'])
        self.assertIn('host: cd.example.com', files['ingress.yaml'])
        self.assertIn('secretName: argocd-ui-tls\n', files['ingress.yaml'])
        self.assertIn('cd.example.com', files['certificate.yaml'])
        self.assertIn('name: letsencrypt-prod', files['certificate.yaml'])
        self.assertIn('kind: ClusterIssuer', files['certificate.yaml'])
        self.assertNotIn('issuer.yaml', files)
        self.assertNotIn('acme@example.invalid', files['cluster-issuers.yaml'])
        self.assertEqual(files['cluster-issuers.yaml'].count('email: test@example.com'), 2)
        self.assertIn('name: letsencrypt-staging', files['cluster-issuers.yaml'])
        self.assertIn('name: letsencrypt-prod', files['cluster-issuers.yaml'])
        patch = json.loads(files['password.json'])['stringData']
        passwd_file = self.root/'passwd'
        passwd_file.write_text('admin:'+patch['admin.password']+'\n')
        verify = subprocess.run(['htpasswd', '-vi', str(passwd_file), 'admin'],
                                input=self.password+'\n', text=True, capture_output=True)
        self.assertEqual(verify.returncode, 0, 'Bcrypt hash does not match the source password')
        self.assertEqual(set(patch), {'admin.password', 'admin.passwordMtime'})
        ssh_args = next(args for tool, args in self.calls() if tool == 'ssh' and '-V' not in args)
        self.assertIn('StrictHostKeyChecking=yes', ssh_args)
        self.assertIn('PreferredAuthentications=password', ssh_args)
        self.assertIn('PubkeyAuthentication=no', ssh_args)
        self.assertIn('BatchMode=no', ssh_args)
        self.assertNotIn('-i', ssh_args)
        self.assertNotIn(self.password, json.dumps(self.calls()))
        self.assertNotIn(self.ssh_password, json.dumps(self.calls()))

    def test_runner_prepare_skips_apt_when_tools_exist(self):
        result = subprocess.run(['bash', str(UI/'deploy.sh'), '--prepare-tools'],
                                env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(any(tool == 'apt-get' for tool, _ in self.calls()))

    def test_invalid_hostname_rejected_before_ssh(self):
        result = self.deploy(ARGOCD_HOSTNAME='bad.example.com/$(id)')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(tool == 'ssh' and '-V' not in args for tool, args in self.calls()))
        self.assertFalse(self.http_calls())

    def test_long_unicode_password_rejected_before_ssh(self):
        result = self.deploy(ARGOCD_ADMIN_PASSWORD='é'*37)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(tool == 'ssh' and '-V' not in args for tool, args in self.calls()))
        self.assertFalse(self.http_calls())

    def test_ssh_failure_stops_verification(self):
        self.assertNotEqual(self.deploy(TEST_CASE='ssh-fail').returncode, 0)
        self.assertFalse(self.http_calls())

    def test_wrong_ssh_password_stops_before_deployment(self):
        self.assertNotEqual(self.deploy(TEST_CASE='bad-ssh-password').returncode, 0)
        self.assertFalse(any(tool == 'ssh' and '-V' not in args for tool, args in self.calls()))
        self.assertFalse(self.http_calls())

    def test_missing_ssh_password_rejected_before_connecting(self):
        self.assertNotEqual(self.deploy(VPS_SSH_PASSWORD='').returncode, 0)
        self.assertFalse(any(tool == 'ssh' and '-V' not in args for tool, args in self.calls()))
        self.assertFalse(self.http_calls())

    def test_multiline_ssh_password_rejected_before_connecting(self):
        self.assertNotEqual(self.deploy(VPS_SSH_PASSWORD='first\nsecond').returncode, 0)
        self.assertFalse(any(tool == 'ssh' and '-V' not in args for tool, args in self.calls()))
        self.assertFalse(self.http_calls())

    def test_tls_failure_stops_login(self):
        self.assertNotEqual(self.deploy(TEST_CASE='tls-fail').returncode, 0)
        self.assertNotIn('/api/v1/session', json.dumps(self.calls()))

    def test_anonymous_access_fails_pipeline(self):
        self.assertNotEqual(self.deploy(TEST_CASE='anonymous-open').returncode, 0)
        self.assertNotIn('/api/v1/session', json.dumps(self.calls()))

    def test_invalid_admin_login_fails_pipeline(self):
        self.assertNotEqual(self.deploy(TEST_CASE='bad-login').returncode, 0)

    def test_certificate_failure_does_not_publish(self):
        result = self.bootstrap('certificate-fail')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('apply' in args and '--dry-run=server' not in args
                             and any(a.endswith('/ingress.yaml') for a in args)
                             for _, args in self.calls()))

    def test_conflicting_flags_stop_before_mutations(self):
        result = self.bootstrap('insecure')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('patch' in args or 'apply' in args for _, args in self.calls()))

    def test_shared_issuer_failure_stops_before_authentication(self):
        result = self.bootstrap('issuer-fail')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('patch' in args for _, args in self.calls()))
        self.assertFalse(any('apply' in args and '--dry-run=server' not in args
                             and any(a.endswith('/certificate.yaml') or a.endswith('/ingress.yaml') for a in args)
                             for _, args in self.calls()))

    def test_api_failure_does_not_install_cert_manager(self):
        result = self.bootstrap('api-fail')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.http_calls())
        self.assertFalse(any('patch' in args or 'apply' in args for _, args in self.calls()))

    def test_bootstrap_preserves_existing_config_scope(self):
        result = self.bootstrap()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        patches = {p.name: json.loads(p.read_text()) for p in self.root.glob('*.patch.json')}
        self.assertEqual(set(patches), {'argocd-secret.patch.json', 'argocd-cm.patch.json', 'argocd-cmd-params-cm.patch.json'})
        self.assertEqual(set(patches['argocd-secret.patch.json']['stringData']), {'admin.password', 'admin.passwordMtime'})
        self.assertFalse(self.http_calls(), 'Existing cert-manager must not be installed again')
        self.assertFalse(any(tool == 'apt-get' for tool, _ in self.calls()), 'Existing tools must not trigger apt')
        calls = self.calls()
        shared = [args for _, args in calls if any(a.endswith('/cluster-issuers.yaml') for a in args)]
        self.assertEqual(len(shared), 2, 'Shared issuers must be dry-run and applied')
        self.assertTrue(all('-n' not in args for args in shared), 'ClusterIssuers are cluster-scoped')
        ready = next(i for i, (_, args) in enumerate(calls) if 'clusterissuer/letsencrypt-prod' in args)
        auth = next(i for i, (_, args) in enumerate(calls) if 'patch' in args)
        self.assertLess(ready, auth)

    def test_bootstrap_installs_missing_cert_manager(self):
        result = self.bootstrap('no-cert-manager')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(any(tool == 'curl' and any('/v1.21.2/' in a for a in args) for tool, args in self.calls()))

    def test_only_missing_jq_is_installed(self):
        result = self.bootstrap(missing_tools='jq')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        installs = [args for tool, args in self.calls() if tool == 'apt-get' and 'install' in args]
        self.assertEqual(installs, [['install', '-y', '--no-upgrade', 'jq']])

    def test_only_missing_curl_is_installed(self):
        result = self.bootstrap(missing_tools='curl')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        installs = [args for tool, args in self.calls() if tool == 'apt-get' and 'install' in args]
        self.assertEqual(installs, [['install', '-y', '--no-upgrade', 'curl']])

    def test_existing_tool_version_is_logged_without_upgrading(self):
        result = self.bootstrap('old-curl')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('curl 7.40.0', result.stdout)
        self.assertFalse(any(tool == 'apt-get' for tool, _ in self.calls()))

    def test_missing_k3s_is_not_installed_automatically(self):
        result = self.bootstrap(missing_tools='k3s')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('k3s is missing', result.stderr)
        self.assertFalse(any(tool == 'apt-get' for tool, _ in self.calls()))

    def test_install_failure_stops_before_kubernetes_changes(self):
        result = self.bootstrap('install-fail', missing_tools='jq')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('patch' in args or 'apply' in args for _, args in self.calls()))

    def test_partial_cert_manager_is_not_overwritten(self):
        result = self.bootstrap('partial-cert-manager')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.http_calls())

    def test_cert_manager_deployments_without_crds_are_not_overwritten(self):
        result = self.bootstrap('cert-manager-without-crds')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('deployments exist without CRDs', result.stderr)
        self.assertFalse(self.http_calls())

    def test_new_cert_manager_requires_supported_kubernetes(self):
        result = self.bootstrap('unsupported-kubernetes')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('requires Kubernetes 1.33-1.36', result.stderr)
        self.assertFalse(self.http_calls())


if __name__ == '__main__':
    unittest.main()
