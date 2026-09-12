job "elenx-reasoning-retention-20260912" {
  type = "batch"
  datacenters = ["lab"]
  meta {
    fleet_owner = "elenx"
    fleet_run_kind = "checkpoint-reasoning-comparison"
    source_repo = "chaoxu/elenx"
  }
  constraint {
    attribute = "${node.unique.name}"
    value = "jupiter"
  }
  constraint {
    attribute = "${meta.fleet_elenx_lab_worker}"
    value = "true"
  }
  reschedule { attempts = 0 }
  group "probe" {
    restart {
      attempts = 0
      mode = "fail"
    }
    volume "runs" {
      type = "host"
      source = "elenx_lab_runs"
      read_only = false
    }
    task "probe" {
      driver = "docker"
      user = "1000:1000"
      kill_signal = "SIGINT"
      kill_timeout = "30s"
      config {
        image = "sha256:4fc87bf3c17e40e42a9ed3107908a912287aee858444d38162dbfe707e3c5096"
        force_pull = false
        network_mode = "bridge"
        readonly_rootfs = true
        command = "bun"
        args = ["--no-install", "--no-env-file", "/runs/_diagnostics/reasoning-retention-20260912/probe.ts"]
        cap_drop = ["ALL"]
        security_opt = ["no-new-privileges"]
        pids_limit = 128
      }
      volume_mount {
        volume = "runs"
        destination = "/runs"
        read_only = false
      }
      resources {
        cpu = 250
        memory = 2048
      }
      logs {
        max_files = 2
        max_file_size = 10
      }
    }
  }
}
