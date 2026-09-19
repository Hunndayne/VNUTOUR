"""Safety tests for monitoring install decisions; no cluster or network is used."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


INSTALL = Path(__file__).resolve().parents[1] / "install" / "monitoring-install.sh"
INSTALL_DIR = INSTALL.parent


class MonitoringInstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.kubeconfig = self.root / "k3s.yaml"
        self.kubeconfig.write_text("test-only")
        self.hostname = self.root / "grafana-hostname"
        self.hostname.write_text("grafana.example.com")

        # The test reaches the CRD safety gate and must never reach download,
        # Secret creation, ConfigMap apply or Helm upgrade.
        (self.bin / "k3s").write_text(
            """#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$TEST_ROOT/k3s-calls"
if [[ "$1" == "--version" ]]; then echo 'k3s version v1.36.3+k3s1'; exit 0; fi
case "$*" in
  *"config current-context"*) echo test-context ;;
  *"get nodes"*) echo test-node ;;
  *"get storageclass local-path"*) exit 0 ;;
  *"get ingressclass nginx -o json"*) echo '{"spec":{"controller":"k8s.io/ingress-nginx"}}' ;;
  *"-n ingress-nginx get deployment ingress-nginx-controller"*) exit 0 ;;
  *"-n ingress-nginx rollout status deployment/ingress-nginx-controller"*) exit 0 ;;
  *"get crd certificates.cert-manager.io clusterissuers.cert-manager.io"*) exit 0 ;;
  *"-n cert-manager get deployment cert-manager"*) exit 0 ;;
  *"wait --for=condition=Ready clusterissuer/letsencrypt-prod"*) exit 0 ;;
  *"get namespace monitoring"*) exit 0 ;;
  *"get deployment prometheus grafana kube-state-metrics"*) exit 0 ;;
  *"get daemonset node-exporter"*) exit 0 ;;
  *"get crd alertmanagerconfigs.monitoring.coreos.com"*) echo existing ;;
  *"get crd "*) exit 1 ;;
  *) echo "unexpected k3s call: $*" >&2; exit 91 ;;
esac
"""
        )
        (self.bin / "helm").write_text(
            """#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$TEST_ROOT/helm-calls"
case "$1" in
  version) echo v4.3.0 ;;
  list) printf '[{"chart":"kube-prometheus-stack-91.4.1"}]' ;;
  *) echo "mutation or download reached: $*" >&2; exit 92 ;;
esac
            """
        )
        (self.bin / "id").write_text("#!/usr/bin/env bash\necho 0\n")
        for path in (self.bin / "k3s", self.bin / "helm", self.bin / "id"):
            path.chmod(0o700)

    def run_install(self):
        env = {
            **os.environ,
            "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
            "TEST_ROOT": str(self.root),
            "K3S_KUBECONFIG": str(self.kubeconfig),
            "GRAFANA_HOSTNAME_FILE": str(self.hostname),
        }
        return subprocess.run(
            ["bash", str(INSTALL)], env=env, text=True, capture_output=True
        )

    def test_partial_crds_stop_before_helm_or_kubernetes_mutation(self):
        result = self.run_install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Found 1/10 monitoring CRDs", result.stderr)
        helm_calls = (self.root / "helm-calls").read_text()
        self.assertNotIn("--all", helm_calls)
        self.assertNotIn("pull", helm_calls)
        self.assertNotIn("upgrade", helm_calls)
        k3s_calls = (self.root / "k3s-calls").read_text()
        self.assertNotIn("create", k3s_calls)
        self.assertNotIn("apply", k3s_calls)

    def test_invalid_hostname_stops_before_cluster_access(self):
        self.hostname.write_text("grafana.example.com/$(id)")

        result = self.run_install()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Grafana hostname must be lowercase DNS", result.stderr)
        self.assertFalse((self.root / "k3s-calls").exists())
        self.assertFalse((self.root / "helm-calls").exists())

    def test_https_templates_use_http_grafana_backend(self):
        ingress = (INSTALL_DIR / "ingress.yaml").read_text()
        certificate = (INSTALL_DIR / "certificate.yaml").read_text()
        values = (INSTALL_DIR / "ingress-values.yaml").read_text()

        self.assertIn("name: monitoring-grafana", ingress)
        self.assertIn("number: 80", ingress)
        self.assertNotIn("backend-protocol", ingress)
        self.assertIn("name: letsencrypt-prod", certificate)
        self.assertIn("namespace: monitoring", certificate)
        self.assertIn("root_url: https://grafana.example.invalid/", values)
        self.assertIn("cookie_secure: true", values)

if __name__ == "__main__":
    unittest.main()
