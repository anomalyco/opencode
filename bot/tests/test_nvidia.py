"""
Tests for shared.nvidia module.
"""
import asyncio
import subprocess
import unittest
from unittest.mock import AsyncMock, patch
from typing import AsyncGenerator

from shared.nvidia import (
    NvidiaInfo,
    GPUInfo,
    run_nvidia_smi,
    parse_nvidia_smi,
    format_for_vk,
    get_gpu_info_vk_message,
)


async def _async_return(value):
    """Helper to return value in async context."""
    return value


# Sample nvidia-smi output for testing
SAMPLE_NVIDIA_OUTPUT = """Fri May  8 12:36:23 2026       
+-----------------------------------------------------------------------------------------+
| NVIDIA-SMI 595.58.03              Driver Version: 595.58.03      CUDA Version: 13.2     |
+-----------------------------------------+------------------------+----------------------+
| GPU  Name                 Persistence-M | Bus-Id          Disp.A | Volatile Uncorr. ECC |
| Fan  Temp   Perf          Pwr:Usage/Cap |           Memory-Usage | GPU-Util  Compute M. |
|                                         |                        |               MIG M. |
|=========================================+========================+======================|
|   0  NVIDIA GeForce RTX 3090        Off |   00000000:04:00.0 Off |                  N/A |
|100%   83C    P2            221W /  350W |   22460MiB /  24576MiB |     20%      Default |
|                                         |                        |                  N/A |
+-----------------------------------------+------------------------+----------------------+
|   1  NVIDIA GeForce RTX 3090        Off |   00000000:0A:00.0 Off |                  N/A |
| 95%   89C    P2            241W /  350W |   22936MiB /  24576MiB |     24%      Default |
|                                         |                        |                  N/A |
+-----------------------------------------+------------------------+----------------------+
|   2  NVIDIA GeForce RTX 3090        Off |   00000000:0B:00.0 Off |                  N/A |
| 93%   87C    P2            254W /  350W |   23362MiB /  24576MiB |     34%      Default |
|                                         |                        |                  N/A |
+-----------------------------------------+------------------------+----------------------+

+-----------------------------------------------------------------------------------------+
| Processes:                                                                              |
|  GPU   GI   CI              PID   Type   Process name                        GPU Memory |
|        ID   ID                                                               Usage      |
|=========================================================================================|
|    0   N/A  N/A            2099      G   /usr/lib/xorg/Xorg                       18MiB |
|    0   N/A  N/A            55085      C   ...ma.cpp/build/bin/llama-server      22382MiB |
|    1   N/A  N/A            2099      G   /usr/lib/xorg/Xorg                        4MiB |
|    1   N/A  N/A           55085      C   ...ma.cpp/build/bin/llama-server      22908MiB |
|    2   N/A  N/A            2099      G   /usr/lib/xorg/Xorg                        4MiB |
|    2   N/A  N/A           55085      C   ...ma.cpp/build/bin/llama-server      23334MiB |
+-----------------------------------------------------------------------------------------+
""".encode("utf-8")


class TestRunNvidiaSmi(unittest.TestCase):
    """Tests for run_nvidia_smi function."""

    @patch('asyncio.create_subprocess_exec')
    def test_run_nvidia_smi_success(self, mock_create):
        """Test successful nvidia-smi execution."""
        # Setup mock
        async def mock_coro():
            mock_process = AsyncMock()
            mock_process.communicate = AsyncMock(return_value=(SAMPLE_NVIDIA_OUTPUT, b""))
            mock_process.returncode = 0
            return mock_process
        
        mock_create.return_value = asyncio.create_task(mock_coro())
        
        # Test
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(run_nvidia_smi())
            
            # Verify
            self.assertEqual(result, SAMPLE_NVIDIA_OUTPUT)
        finally:
            loop.close()

    def test_run_nvidia_smi_not_found(self):
        """Test nvidia-smi not found error."""
        loop = asyncio.new_event_loop()
        try:
            async def mock_coro():
                raise FileNotFoundError("nvidia-smi not found")
            
            with patch('asyncio.create_subprocess_exec') as mock_create:
                mock_create.return_value = asyncio.create_task(mock_coro())
                try:
                    loop.run_until_complete(run_nvidia_smi())
                    self.fail("Expected FileNotFoundError")
                except FileNotFoundError as e:
                    self.assertIn("nvidia-smi not found", str(e))
        finally:
            loop.close()

    def test_run_nvidia_smi_timeout(self):
        """Test nvidia-smi timeout error."""
        loop = asyncio.new_event_loop()
        try:
            async def mock_coro():
                mock_process = AsyncMock()
                mock_process.communicate = AsyncMock(side_effect=asyncio.TimeoutError())
                return mock_process
            
            with patch('asyncio.create_subprocess_exec') as mock_create:
                mock_create.return_value = asyncio.create_task(mock_coro())
                
                try:
                    loop.run_until_complete(run_nvidia_smi(timeout=1))
                    self.fail("Expected TimeoutError")
                except asyncio.TimeoutError:
                    pass
        finally:
            loop.close()


class TestParseNvidiaSmi(unittest.TestCase):
    """Tests for parse_nvidia_smi function."""

    def test_parse_sample_output(self):
        """Test parsing sample nvidia-smi output."""
        info = parse_nvidia_smi(SAMPLE_NVIDIA_OUTPUT)
        
        # Verify basic info
        self.assertEqual(info.gpu_count, 3)
        self.assertEqual(info.driver_version, "595.58.03")
        self.assertEqual(info.cuda_version, "13.2")

    def test_parse_single_gpu(self):
        """Test parsing output with single GPU."""
        single_gpu_output = """Fri May  8 12:36:23 2026
+-----------------------------------------------------------------------------------------+
| NVIDIA-SMI 595.58.03              Driver Version: 595.58.03      CUDA Version: 13.2     |
+-----------------------------------------+------------------------+----------------------+
| GPU  Name                 Persistence-M | Bus-Id          Disp.A | Volatile Uncorr. ECC |
| Fan  Temp   Perf          Pwr:Usage/Cap |           Memory-Usage | GPU-Util  Compute M. |
|=========================================+========================+======================|
|   0  NVIDIA GeForce RTX 4090        Off |   00000000:01:00.0 Off |                  N/A |
| 50%   70C    P2            150W /  450W |   10000MiB /  24576MiB |     15%      Default |
+-----------------------------------------+------------------------+----------------------+
+-----------------------------------------------------------------------------------------+
| Processes:                                                                              |
+-----------------------------------------------------------------------------------------+
""".encode("utf-8")
        
        info = parse_nvidia_smi(single_gpu_output)
        
        self.assertEqual(info.gpu_count, 1)
        gpu = info.gpus[0]
        self.assertEqual(gpu.id, 0)
        self.assertIn("RTX 4090", gpu.name)
        self.assertEqual(gpu.fan_speed, 50)
        self.assertEqual(gpu.temperature, 70)
        self.assertEqual(gpu.perf_state, "P2")
        self.assertEqual(gpu.power_usage, 150)
        self.assertEqual(gpu.power_cap, 450)
        self.assertEqual(gpu.memory_used, 10000)
        self.assertEqual(gpu.memory_total, 24576)
        self.assertEqual(gpu.gpu_utilization, 15)

    def test_parse_empty_output(self):
        """Test parsing empty output."""
        info = parse_nvidia_smi(b"")
        
        self.assertEqual(info.gpu_count, 0)
        self.assertEqual(info.driver_version, "unknown")
        self.assertEqual(info.cuda_version, "unknown")


class TestFormatForVk(unittest.TestCase):
    """Tests for format_for_vk function."""

    def test_format_single_gpu(self):
        """Test formatting single GPU info."""
        gpu = GPUInfo(
            id=0,
            name="NVIDIA GeForce RTX 3090",
            fan_speed=80,
            temperature=75,
            perf_state="P2",
            power_usage=200,
            power_cap=350,
            memory_used=15000,
            memory_total=24576,
            gpu_utilization=45,
            compute_mode="Default"
        )
        info = NvidiaInfo(
            driver_version="595.58.03",
            cuda_version="13.2",
            gpus=[gpu]
        )
        
        message = format_for_vk(info)
        
        # Verify message contains key information
        self.assertIn("NVIDIA", message)
        self.assertIn("3090", message)
        self.assertIn("75°C", message)
        self.assertIn("80%", message)
        self.assertIn("200W", message)
        self.assertIn("350W", message)
        self.assertIn("15000", message)
        self.assertIn("24576", message)
        self.assertIn("45%", message)

    def test_format_multiple_gpus(self):
        """Test formatting multiple GPU info."""
        gpus = [
            GPUInfo(
                id=i,
                name=f"NVIDIA GeForce RTX 3090 #{i}",
                fan_speed=70 + i * 5,
                temperature=70 + i * 2,
                perf_state="P2",
                power_usage=200 + i * 10,
                power_cap=350,
                memory_used=10000 + i * 2000,
                memory_total=24576,
                gpu_utilization=30 + i * 5,
                compute_mode="Default"
            )
            for i in range(3)
        ]
        info = NvidiaInfo(
            driver_version="595.58.03",
            cuda_version="13.2",
            gpus=gpus
        )
        
        message = format_for_vk(info)
        
        # Verify all GPUs are mentioned
        self.assertIn("GPU 0:", message)
        self.assertIn("GPU 1:", message)
        self.assertIn("GPU 2:", message)


class TestGetGpuInfoVkMessage(unittest.TestCase):
    """Tests for get_gpu_info_vk_message function."""

    def test_get_gpu_info_vk_message_success(self):
        """Test successful GPU info retrieval."""
        loop = asyncio.new_event_loop()
        try:
            with patch('shared.nvidia.run_nvidia_smi') as mock_run:
                mock_run.return_value = asyncio.create_task(_async_return(SAMPLE_NVIDIA_OUTPUT))
                message, error = loop.run_until_complete(get_gpu_info_vk_message())
                
                self.assertIsNotNone(message)
                self.assertIsNone(error)
                self.assertIn("NVIDIA", message)
        finally:
            loop.close()

    def test_get_gpu_info_vk_message_not_found(self):
        """Test GPU info retrieval when nvidia-smi not found."""
        loop = asyncio.new_event_loop()
        try:
            with patch('shared.nvidia.run_nvidia_smi') as mock_run:
                mock_run.side_effect = FileNotFoundError("nvidia-smi not found")
                message, error = loop.run_until_complete(get_gpu_info_vk_message())
                
                self.assertIsNone(message)
                self.assertIsNotNone(error)
                self.assertIn("not found", error.lower())
        finally:
            loop.close()

    def test_get_gpu_info_vk_message_timeout(self):
        """Test GPU info retrieval on timeout."""
        loop = asyncio.new_event_loop()
        try:
            with patch('shared.nvidia.run_nvidia_smi') as mock_run:
                mock_run.side_effect = asyncio.TimeoutError()
                message, error = loop.run_until_complete(get_gpu_info_vk_message())
                
                self.assertIsNone(message)
                self.assertIsNotNone(error)
                self.assertIn("timed out", error.lower())
        finally:
            loop.close()


class TestGpuInfoProperties(unittest.TestCase):
    """Tests for GPUInfo dataclass properties."""

    def test_memory_percent(self):
        """Test memory usage percentage calculation."""
        gpu = GPUInfo(
            id=0,
            name="Test GPU",
            fan_speed=0,
            temperature=0,
            perf_state="",
            power_usage=0,
            power_cap=0,
            memory_used=12288,
            memory_total=24576,
            gpu_utilization=0,
            compute_mode=""
        )
        
        self.assertEqual(gpu.memory_percent, 50)

    def test_power_percent(self):
        """Test power usage percentage calculation."""
        gpu = GPUInfo(
            id=0,
            name="Test GPU",
            fan_speed=0,
            temperature=0,
            perf_state="",
            power_usage=175,
            power_cap=350,
            memory_used=0,
            memory_total=0,
            gpu_utilization=0,
            compute_mode=""
        )
        
        self.assertEqual(gpu.power_percent, 50)


if __name__ == '__main__':
    unittest.main()
