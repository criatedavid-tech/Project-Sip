terraform {
  required_version = ">= 1.5.0, < 2.0.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 6.0.0, < 8.0.0"
    }
  }
}

provider "oci" {
  region = var.region
}

data "oci_identity_availability_domains" "available" {
  compartment_id = var.tenancy_ocid
}

data "oci_core_images" "ubuntu_arm" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_core_vcn" "project_sip" {
  compartment_id = var.compartment_ocid
  cidr_blocks     = ["10.0.0.0/24"]
  display_name    = "project-sip-vcn"
  dns_label       = "projectsip"
}

resource "oci_core_internet_gateway" "project_sip" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.project_sip.id
  display_name   = "project-sip-internet-gateway"
  enabled        = true
}

resource "oci_core_route_table" "project_sip_public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.project_sip.id
  display_name   = "project-sip-public-routes"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.project_sip.id
  }
}

resource "oci_core_security_list" "project_sip" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.project_sip.id
  display_name   = "project-sip-security-list"

  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
    stateless   = false
  }

  ingress_security_rules {
    description = "SSH"
    protocol    = "6"
    source      = var.admin_cidr
    stateless   = false

    tcp_options {
      min = 22
      max = 22
    }
  }

  ingress_security_rules {
    description = "HTTP"
    protocol    = "6"
    source      = "0.0.0.0/0"
    stateless   = false

    tcp_options {
      min = 80
      max = 80
    }
  }

  ingress_security_rules {
    description = "HTTPS"
    protocol    = "6"
    source      = "0.0.0.0/0"
    stateless   = false

    tcp_options {
      min = 443
      max = 443
    }
  }

  dynamic "ingress_security_rules" {
    for_each = toset(var.directcall_sip_source_ips)

    content {
      description = "SIP DirectCall ${ingress_security_rules.value}"
      protocol    = "17"
      source      = "${ingress_security_rules.value}/32"
      stateless   = false

      udp_options {
        min = 5060
        max = 5060
      }
    }
  }

  ingress_security_rules {
    description = "RTP de audio"
    protocol    = "17"
    source      = "0.0.0.0/0"
    stateless   = false

    udp_options {
      min = 10000
      max = 10099
    }
  }
}

resource "oci_core_subnet" "project_sip_public" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.project_sip.id
  cidr_block                 = "10.0.0.0/24"
  display_name               = "project-sip-public-subnet"
  dns_label                  = "public"
  prohibit_public_ip_on_vnic = false
  route_table_id             = oci_core_route_table.project_sip_public.id
  security_list_ids          = [oci_core_security_list.project_sip.id]
}

resource "oci_core_instance" "project_sip" {
  availability_domain = data.oci_identity_availability_domains.available.availability_domains[0].name
  compartment_id      = var.compartment_ocid
  display_name        = "project-sip-vps"
  shape               = "VM.Standard.A1.Flex"

  shape_config {
    ocpus         = 1
    memory_in_gbs = 4
  }

  create_vnic_details {
    assign_public_ip = true
    display_name     = "project-sip-vnic"
    hostname_label   = "project-sip"
    subnet_id        = oci_core_subnet.project_sip_public.id
  }

  metadata = {
    ssh_authorized_keys = trimspace(var.ssh_public_key)
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu_arm.images[0].id
    boot_volume_size_in_gbs = 50
    boot_volume_vpus_per_gb = 10
  }

  preserve_boot_volume = false
}
