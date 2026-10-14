import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('rebrand', Path(__file__).parents[1] / 'scripts/rebrand.py')
rebrand = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rebrand)


class RebrandTests(unittest.TestCase):
    def test_casing_and_generic_mask(self):
        original = 'Nullmask nullMask nullmask NULLMASK null_mask NULL_MASK NullMask MASK MASK_PRICE bitmask mask'
        self.assertEqual(rebrand.rename_text(original, 'uppercase'),
            'CipherShroud cipherShroud ciphershroud CIPHERSHROUD cipher_shroud CIPHER_SHROUD CipherShroud SHROUD SHROUD_PRICE bitmask mask')
        self.assertEqual(rebrand.rename_text('Mask mask MASK masked unmask', 'all'), 'Shroud shroud SHROUD masked unmask')

    def test_replaces_owned_config_preserves_other_addresses_and_attribution(self):
        wallet = '0x' + '1' * 40
        source = f'DEV_WALLET="{wallet}"\nverifier="{wallet}"\nRPC_URL="https://provider.test/token"\nhttps://x.com/nullmask\nCopyright Nullmask\n'
        result = rebrand.transform(source, 'uppercase', {})
        self.assertIn('PLACEHOLDER_DEV_WALLET', result)
        self.assertIn(f'verifier="{wallet}"', result)
        self.assertIn('YOUR_NEW_EVM_RPC_URL', result)
        self.assertIn('PLACEHOLDER_OFFICIAL_SOCIAL_URL', result)
        self.assertIn('Copyright Nullmask', result)

    def test_nested_rename_backup_restore_and_binary(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'repo'
            (root / 'null_mask').mkdir(parents=True)
            source = root / 'null_mask' / 'NullMask.txt'
            source.write_bytes(b'Nullmask\r\nMASK\r\n')
            (root / 'null_mask' / 'proof.bin').write_bytes(b'\0Nullmask')
            (root / 'LICENSE').write_text('Copyright Nullmask')
            before = source.read_bytes()
            files, moves, _ = rebrand.plan(root, {}, 'uppercase')
            backup = rebrand.apply(root, files, moves)
            target = root / 'cipher_shroud' / 'CipherShroud.txt'
            self.assertEqual(target.read_bytes(), b'CipherShroud\r\nSHROUD\r\n')
            self.assertEqual((root / 'cipher_shroud' / 'proof.bin').read_bytes(), b'\0Nullmask')
            self.assertEqual((root / 'LICENSE').read_text(), 'Copyright Nullmask')
            rebrand.restore(backup)
            self.assertEqual(source.read_bytes(), before)

    def test_collision_and_symlink_refusal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'Nullmask.txt').write_text('old')
            (root / 'CipherShroud.txt').write_text('new')
            with self.assertRaisesRegex(ValueError, 'collision'):
                rebrand.plan(root, {}, 'uppercase')
            (root / 'CipherShroud.txt').unlink()
            (root / 'link').symlink_to('Nullmask.txt')
            with self.assertRaisesRegex(ValueError, 'Symlink'):
                rebrand.plan(root, {}, 'uppercase')

    def test_restore_refuses_later_edits(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'repo'
            root.mkdir()
            (root / 'Nullmask.txt').write_text('MASK')
            files, moves, _ = rebrand.plan(root, {}, 'uppercase')
            backup = rebrand.apply(root, files, moves)
            (root / 'CipherShroud.txt').write_text('later work')
            with self.assertRaisesRegex(ValueError, 'Refusing'):
                rebrand.restore(backup)

    def test_utf16_and_identifier_boundaries(self):
        data = 'Nullmask MASKING maskPrice'.encode('utf-16')
        text, encoding = rebrand.decode(data)
        self.assertEqual(rebrand.transform(text, 'all', {}).encode(encoding), 'CipherShroud MASKING shroudPrice'.encode('utf-16'))

    def test_write_failure_rolls_back_original_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'repo'
            root.mkdir()
            for name in ['a.txt', 'b.txt']:
                (root / name).write_text('Nullmask')
            files, moves, _ = rebrand.plan(root, {}, 'uppercase')
            original = rebrand.atomic_write
            calls = 0
            def fail_once(*args):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise OSError('simulated disk error')
                original(*args)
            with patch.object(rebrand, 'atomic_write', side_effect=fail_once):
                with self.assertRaises(OSError):
                    rebrand.apply(root, files, moves)
            self.assertEqual((root / 'a.txt').read_text(), 'Nullmask')
            self.assertEqual((root / 'b.txt').read_text(), 'Nullmask')

    def test_optional_root_rename_and_restore(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve() / 'NullMask'
            root.mkdir()
            (root / 'MASK.txt').write_text('Nullmask')
            files, moves, _ = rebrand.plan(root, {}, 'uppercase')
            backup = rebrand.apply(root, files, moves, rename_root=True)
            self.assertFalse(root.exists())
            self.assertTrue((root.parent / 'CipherShroud' / 'SHROUD.txt').exists())
            rebrand.restore(backup)
            self.assertEqual((root / 'MASK.txt').read_text(), 'Nullmask')


if __name__ == '__main__':
    unittest.main()
