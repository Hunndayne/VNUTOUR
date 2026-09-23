"""Safety tests for monitoring install decisions; no cluster or network is used."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


INSTALL = Path(__file__).resolve().parents[1] / "install" / "monitoring-install.sh"
INSTALL_DIR = INSTALL.parent
DEPLOY = INSTALL_DIR / "deploy.sh"


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

    def test_dashboard_is_valid_json_and_can_be_canonicalized(self):
        dashboard_dir = INSTALL_DIR.parent / "dashboard"
        for dashboard_name in (
            "vps_k3s_dashboard.json",
            "homelab_k3s_dashboard.json",
        ):
            canonical = subprocess.run(
                ["jq", "-S", "-c", ".", str(dashboard_dir / dashboard_name)],
                check=True,
                capture_output=True,
            ).stdout
            self.assertTrue(canonical)

        deploy = DEPLOY.read_text()
        self.assertIn('jq -S -c . "$dashboard_source"', deploy)
        self.assertIn("homelab_k3s_dashboard.json", deploy)

    def test_homelab_dashboard_combines_cluster_and_workload_panels(self):
        dashboard_dir = INSTALL_DIR.parent / "dashboard"
        vps = json.loads((dashboard_dir / "vps_k3s_dashboard.json").read_text())
        homelab = json.loads(
            (dashboard_dir / "homelab_k3s_dashboard.json").read_text()
        )
        vps_titles = {panel.get("title") for panel in vps["panels"]}
        homelab_titles = {panel.get("title") for panel in homelab["panels"]}
        workload_titles = {
            "API requests/sec by view",
            "API latency p95 / p50",
            "Responses by status",
            "Replicas: desired vs available",
            "CPU cores per pod",
            "Memory working set per pod",
            "Postgres connections by state",
            "Nginx requests/sec (edge)",
        }

        self.assertEqual(homelab["title"], "K3S cluster monitoring on Homelab")
        self.assertEqual(homelab["uid"], "k3s-homelab")
        self.assertTrue(vps_titles.issubset(homelab_titles))
        self.assertTrue(workload_titles.issubset(homelab_titles))
        self.assertEqual(len(homelab["panels"]), len(vps["panels"]) + 9)
        for panel in homelab["panels"]:
            if panel.get("type") != "row":
                self.assertEqual(panel.get("datasource"), "${DS_PROMETHEUS}")

    def test_vps_grafana_has_private_homelab_datasource(self):
        values = (INSTALL_DIR / "values.yaml").read_text()

        self.assertIn("name: Prometheus Homelab", values)
        self.assertIn("uid: prometheus-homelab", values)
        self.assertIn("url: http://192.168.1.110:30900", values)
        self.assertIn("isDefault: false", values)

if __name__ == "__main__":
    unittest.main()
